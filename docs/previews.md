# Previews (upload HTML / artifacts / video from the CLI)

`mt preview <path>` uploads one file from the CLI, stores it in R2,
and serves it publicly at `https://preview.makarima.xyz/<id>`. Dedicated host,
~100 MiB per-file cap, TTL with cron cleanup. This document is the feature
reference.

Uploads are plain HTTPS to the Worker API. The tunnel WebSocket protocol is
untouched.

## UX

```console
$ mt preview demo.mp4                     # single file (video, HTML, ...)
https://preview.makarima.xyz/p7w3k9...

$ mt preview list                         # aliases: ls
$ mt preview delete <id>                  # aliases: rm

$ mt preview ./dist --group eod-report    # custom dashboard group
$ mt preview ./dist --visibility code --code letmein-secure   # gate behind an access code
$ mt preview visibility <id> private                   # change later
```

## Storage and metadata

- New R2 binding `PREVIEWS` (bucket `mtunnel-previews`). Object keys:
  `<organization-id>/<preview-name>/<preview-id>`. Each
  object stores the preview version in custom metadata. Content stored only in R2.
- Preview metadata lives in migrations `0005_previews.sql` through
  `0010_preview_group.sql` on the existing `DOMAINS` database. Later migrations
  add visibility, versions, stable document IDs, access records, and groups;
  use the migrations as the canonical schema definition.

- Preview ID: 128-bit random, base32-lowercase (unguessable; public previews
  are public-by-URL, no per-request auth on the serving side).
- Migration `0006_preview_visibility.sql` adds `visibility TEXT NOT NULL
DEFAULT 'public'` (`public` | `private` | `code`) and `access_code_hash TEXT`
  (`v2:<salt-hex>:<hmac-hex>`, set only for `code`).
- Migration `0008_preview_versions.sql` adds `version`; uploads with the same
  filename and repository metadata create a new immutable version and ID.
- Migration `0009_preview_document_access.sql` adds stable `document_id`
  grouping across versions, one-time code records, and 24-hour session grants.

## API (new `apps/api/src/routes/(api)/previews.ts`, follows domains.ts)

All authenticated with `authenticateUser` + `X-Organization-Id`, quota-checked
via `limitsForOrganization` (extended, see Limits).

- `POST /api/v1/previews` — body `{name, files: [{path, size, contentType,
sha256}]}` plus optional `visibility` (`public` default | `private` | `code`)
  and `accessCode` (required iff `visibility` is `code`, 12–128 chars). Access
  codes are peppered with `AUTH_SECRET` before storage and become invalid after
  one successful redemption.
  Validates paths (reject absolute, `..`, backslashes, empty),
  per-file/per-preview/org-quota limits. Inserts the D1 row, returns
  `201 {id, documentId, url, expiresAt, visibility, ...}`.
- `PATCH /api/v1/previews/:id` — body `{visibility, accessCode?}` (same rules)
  updates visibility and mints a new one-time code for the document. Existing
  24-hour grants remain valid.
- `PUT /api/v1/previews/:id/files/<url-encoded-path>` — ownership check, path
  must exist in the manifest, `Content-Length` must match. Streams
  `request.body` straight into `env.PREVIEWS.put(key, body, {httpMetadata:
{contentType}, sha256})` (R2 verifies the checksum). No buffering in Worker
  memory.
- `GET /api/v1/previews` — list the organization's previews.
- `DELETE /api/v1/previews/:id` — delete the R2 object, then the D1 row.

## Serving (dedicated host)

`wrangler.jsonc` already routes `*.makarima.xyz/*` to the Worker, so
`preview.makarima.xyz` needs no DNS or cert changes. New var
`PREVIEW_DOMAIN=preview.makarima.xyz`.

In `handleRequest` (index.ts), after the site/API checks and before
`tunnelIdFromHost`: if hostname equals `env.PREVIEW_DOMAIN`, serve the preview.
This ordering also reserves the name — a tunnel named `preview` must never
claim the host (add it to any reserved-name validation if that exists).

New `routes/(preview)/serve.ts`:

- `GET /<id>/<path>` → `env.PREVIEWS.get(key, {range})`. Honor `Range` requests
  (required for video seeking); return 206 with `Content-Range`. Pass through
  the object's stored Content-Type and ETag.
- `GET /<id>/` → serve the uploaded file.
- Unknown preview/file → the existing `siteNotFound()` page.
- Headers: `x-content-type-options: nosniff`, short `cache-control:
public, max-age=60` with ETag revalidation. Do not use the Cache API.
- Expired previews: object may already be gone (cron), but also check
  `expires_at` in D1 and return 404/410 past expiry.
- Visibility gate (before any R2 read): `private` → styled 403 page. `code` →
  requires a server-side grant referenced by the opaque
  `preview_access_session` cookie. A valid form submission or `?code=<code>`
  atomically consumes the one-time code, grants its document for 24 hours, sets
  the cookie (`Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`), and
  303-redirects to the clean URL. The grant applies to every version sharing
  the document ID. Gated responses use `cache-control: private, no-store`.

## TTL cleanup (cron)

Add `triggers: { crons: ["23 * * * *"] }` to wrangler.jsonc and a `scheduled`
handler in the default export: select up to 100 rows with `expires_at < now`,
delete each R2 prefix, then delete the rows. Hourly cadence keeps worst-case
overstay to ~1 hour.

## Limits (extend `OrganizationLimits` in access.ts)

| Limit                           | Restricted | Unrestricted |
| ------------------------------- | ---------- | ------------ |
| maximumPreviews                 | 20         | null         |
| maximumPreviewBytes (aggregate) | 2 GiB      | null         |
| maximumPreviewFileBytes         | 100 MiB    | 100 MiB      |
| previewTTLSeconds               | 7 days     | 30 days      |

The 100 MiB file cap sits safely under the Worker request-body limit; larger
video needs R2 multipart upload (out of scope for v1).

Vars: `PREVIEW_DOMAIN`, `MAX_PREVIEW_FILE_BYTES`, `PREVIEW_TTL_SECONDS`
(restricted defaults; unrestricted values in access.ts).

## CLI (`apps/cli/cmd/tunnel/preview.go`, follows domain.go)

- Reuse `loadConfig` / `doAuthenticated`; same bearer + org header flow.
- Read the argument file; reject directories, symlinks, and anything over the
  file cap with a clear error. Content-Type via `mime.TypeByExtension`,
  fallback `http.DetectContentType`. SHA-256 the file for the manifest.
- `POST` the manifest, then `PUT` the file with one
  retry on 5xx/network errors (idempotent: same key, same bytes). Stream with
  `os.Open` as the request body; set `Content-Length`.
- Progress to stderr (agent-first: one log line via the existing
  slog setup), final URL to stdout so `mt preview demo.mp4 | pbcopy` works.
- `list` prints a tabwriter table like `domain list`; `delete` mirrors
  `domain delete`.
- `--group <name>` adds a custom dashboard group within the repository. Repeated
  uploads of the same path name increment that file's version.

## Tests

- `apps/api/test/previews.test.ts`: API validation, quota enforcement,
  ownership, upload→serve round trip including a Range request, expiry, delete
  (the Workers Vitest pool provides R2 in miniflare; add the binding to
  vitest.config.ts).
- Cron: invoke the `scheduled` handler in a test with an expired row.
- `apps/cli/cmd/tunnel/preview_test.go`: manifest building, path
  validation, error output; upload flow against an httptest server.

## Visibility

Every preview has a visibility, manageable from the CLI (`--visibility`/
`--code` on create, `mt preview visibility <id> <value>` to change) and from
the dashboard assets page:

- `public` — anyone with the URL (v1 behavior, default).
- `private` — serving host returns 403; manage/delete still works via the
  authenticated API.
- `code` — public URL, but visitors must enter an access code once per
  browser. Each code works once; the resulting server-side document grant
  works across versions for 24 hours. Another device needs a newly minted code.

## Explicitly out of scope (v1)

- Resumable/chunked uploads over 100 MiB (R2 multipart).
- Custom names or custom domains for previews.
