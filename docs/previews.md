# Previews (upload HTML / artifacts / video from the CLI)

Plan for `mt preview <path>`: upload a file or directory from the CLI, store it
in R2, and serve it publicly at `https://preview.makarima.xyz/<id>/`. Decisions
already made: dedicated host, ~100 MiB per-file cap, TTL with cron cleanup.

Uploads are plain HTTPS to the Worker API. The tunnel WebSocket protocol is
untouched.

## UX

```console
$ mt preview ./dist                       # directory (static site / artifacts)
https://preview.makarima.xyz/p7w3k9.../   (24 files, expires in 7 days)

$ mt preview demo.mp4                     # single file (video, HTML, ...)
https://preview.makarima.xyz/p7w3k9.../demo.mp4

$ mt preview list                         # aliases: ls
$ mt preview delete <id>                  # aliases: rm
```

## Storage and metadata

- New R2 binding `PREVIEWS` (bucket `mtunnel-previews`). Object keys:
  `<preview-id>/<relative-file-path>`. Content stored only in R2.
- New D1 migration `0005_previews.sql` on the existing `DOMAINS` database:

```sql
CREATE TABLE previews (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,               -- basename of the uploaded path
  manifest TEXT NOT NULL,           -- JSON: [{path, size, contentType, sha256}]
  total_bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX previews_organization_id ON previews(organization_id);
CREATE INDEX previews_expires_at ON previews(expires_at);
```

- Preview ID: 128-bit random, base32-lowercase (unguessable; previews are
  public-by-URL, no per-request auth on the serving side).

## API (new `apps/api/src/routes/(api)/previews.ts`, follows domains.ts)

All authenticated with `authenticateUser` + `X-Organization-Id`, quota-checked
via `limitsForOrganization` (extended, see Limits).

- `POST /api/v1/previews` — body `{name, files: [{path, size, contentType,
sha256}]}`. Validates paths (reject absolute, `..`, backslashes, empty),
  per-file/per-preview/org-quota limits. Inserts the D1 row, returns
  `201 {id, url, expiresAt}`.
- `PUT /api/v1/previews/:id/files/<url-encoded-path>` — ownership check, path
  must exist in the manifest, `Content-Length` must match. Streams
  `request.body` straight into `env.PREVIEWS.put(key, body, {httpMetadata:
{contentType}, sha256})` (R2 verifies the checksum). No buffering in Worker
  memory.
- `GET /api/v1/previews` — list the organization's previews.
- `DELETE /api/v1/previews/:id` — delete R2 objects by prefix `<id>/`, then the
  D1 row.

Register the routes in `routes/(api)/index.ts` and add `preview_created` /
`preview_deleted` to `trackedApiEvent`.

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
- `GET /<id>/` → serve `<id>/index.html` if present; otherwise render a minimal
  HTML listing from an R2 prefix list (useful for artifact directories).
- Unknown preview/file → the existing `siteNotFound()` page.
- Headers: `x-content-type-options: nosniff`, short `cache-control:
public, max-age=60` with ETag revalidation. Do not use the Cache API.
- Expired previews: object may already be gone (cron), but also check
  `expires_at` in D1 and return 404/410 past expiry.

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
| maximumPreviewFiles             | 500        | null         |
| previewTTLSeconds               | 7 days     | 30 days      |

The 100 MiB file cap sits safely under the Worker request-body limit; larger
video needs R2 multipart upload (out of scope for v1).

Vars: `PREVIEW_DOMAIN`, `MAX_PREVIEW_FILE_BYTES`, `MAX_PREVIEW_FILES`,
`PREVIEW_TTL_SECONDS` (restricted defaults; unrestricted values in access.ts).

## CLI (`apps/cli/cmd/tunnel/preview.go`, follows domain.go)

- Reuse `loadConfig` / `doAuthenticated`; same bearer + org header flow.
- Walk the argument path (file or directory; skip symlinks and anything over
  the file cap with a clear error). Content-Type via `mime.TypeByExtension`,
  fallback `http.DetectContentType`. SHA-256 per file for the manifest.
- `POST` the manifest, then `PUT` each file with 4 concurrent workers, one
  retry on 5xx/network errors (idempotent: same key, same bytes). Stream with
  `os.Open` as the request body; set `Content-Length`.
- Progress to stderr (agent-first: one log line per file via the existing
  slog setup), final URL to stdout so `mt preview ./dist | pbcopy` works.
- `list` prints a tabwriter table like `domain list`; `delete` mirrors
  `domain delete`.

## Tests

- `apps/api/test/previews.test.ts`: API validation, quota enforcement,
  ownership, upload→serve round trip including a Range request, expiry, delete
  (the Workers Vitest pool provides R2 in miniflare; add the binding to
  vitest.config.ts).
- Cron: invoke the `scheduled` handler in a test with an expired row.
- `apps/cli/cmd/tunnel/preview_test.go`: manifest building, path
  validation, error output; upload flow against an httptest server.

## Docs to update when implementing

- `architecture.md` and `plan.md` currently state there is no R2 — revise the
  "State and bounds" section: tunnel traffic stays unpersisted; previews are
  the single R2 use case.
- `deployment.md`: create the R2 bucket, note the cron trigger, no DNS changes
  needed.
- `docs/analytics.md`: new events.

## Rollout order

1. wrangler.jsonc binding + vars + cron, env.ts, migration, access.ts limits.
2. Edge API + serving + scheduled handler, with tests.
3. CLI command with tests.
4. Docs.

## Explicitly out of scope (v1)

- Resumable/chunked uploads over 100 MiB (R2 multipart).
- Authenticated/private previews.
- Custom names or custom domains for previews.
