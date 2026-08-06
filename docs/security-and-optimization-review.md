# Security and optimization review

> Backlog audit. Findings are historical recommendations; verify against the
> current implementation before scheduling or closing work.

Code review of the API Worker, Durable Objects, shared core, dashboard, and Go
agent as of 2026-08-02. Ordered by impact. File references point at the code in
question.

## Security findings

### 1. Preview access codes are brute-forceable (high)

`servePreview` has no rate limiting: `PROXY_RATE_LIMITER` only guards tunnel
routes, so `POST` code submissions on the preview domain are unthrottled
(`apps/api/src/routes/(preview)/serve.ts:135`). Combined with a 4-character
minimum (`packages/core/src/preview-access.ts:4`) and a single salted SHA-256
as the stored hash (`hashAccessCode`), codes can be guessed online quickly and
cracked offline trivially if D1 leaks.

Fix: rate-limit code submissions per IP+preview, raise the minimum length,
and use a slow KDF (PBKDF2/scrypt) or HMAC the hash with `AUTH_SECRET` as a
pepper so a D1 dump alone is not crackable.

### 2. Email-domain auto-join can group strangers into one organization (high)

`createPersonalOrganization` registers the signup email's domain with
`state: "verified"` without any domain verification, and `ensureForUser`
auto-joins later signups whose email matches a "verified" org domain
(`packages/core/src/organizations.ts:162-268`). The `PUBLIC_EMAIL_DOMAINS`
denylist is ~20 entries; it misses comcast.net, mail.ru, qq.com, web.de,
universities, and every other shared provider. Two unrelated users on the same
non-listed provider end up in one organization with full mutual access to
tunnels, custom domains, and previews.

Fix: don't set `state: "verified"` on personal orgs (let WorkOS domain
verification do it), or drop domain-based auto-join entirely and rely on
invitations.

### 3. Dashboard session cookie never expires server-side (medium)

The signed `mt_session` payload has no `iat`/`exp`
(`apps/dashboard/src/server/session.ts:78`). `Max-Age` is browser-enforced
only, so a stolen cookie value verifies forever. `signOut` merely deletes the
cookie (`apps/dashboard/src/server/auth.ts:74`) — it does not revoke the WorkOS
session/refresh token, so the captured value keeps working after "sign out".

Fix: include `iat`/`exp` in the signed payload and reject expired values;
call the WorkOS session-revocation endpoint on sign-out.

### 4. Dashboard server functions skip runtime validation (medium)

TanStack `validator` callbacks are pass-through casts. `createPreview` feeds
client-supplied `files` straight into `Previews.create`, which never decodes
`PreviewFile` (`apps/dashboard/src/server/previews.ts:71`,
`packages/core/src/previews.ts:182`). Consequences:

- Negative `size` values pass `file.size > limit` and undercount
  `total_bytes`, bypassing the `maximumPreviewBytes` quota.
- Path/sha256/contentType patterns are unenforced on this path (the stored
  manifest later fails decode, bricking uploads with `invalid_manifest`).

The API route validates the same body properly
(`apps/api/src/routes/(api)/previews.ts:59`); the dashboard path must too.
Fix: decode with `Schemas.PreviewCreateRequest` inside `Previews.create` so
both callers are covered.

### 5. Opt-in tunnel CORS reflects any origin with credentials (medium, by design)

With `--allow-cors`, the Worker reflects the request `Origin`, sets
`access-control-allow-credentials: true`, and echoes requested headers
(`apps/api/src/routes/(tunnel)/proxy.ts:104-132`). Any website can then make
credentialed reads against the tunneled app — SOP is fully disabled for it.
Acceptable for a dev flag, but consider requiring an origin allowlist
(`--allow-cors=https://app.example.com`) and defaulting credentials off.

### 6. All previews share one origin (medium)

Every preview lives under `preview.makarima.xyz/<id>/`. Script in any public
preview runs same-origin with all others and can fetch a code-protected
preview using the visitor's path-scoped access cookie (path-scoping lim
