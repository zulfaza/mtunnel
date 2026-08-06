# Security & Optimization Review

> Backlog audit. Findings are historical recommendations; verify against the
> current implementation before scheduling or closing work.

Review of the mtunnel monorepo (API Worker, dashboard, `@tunnel/core`, Go CLI).
Scoped to the intended single-owner development-tunnel threat model documented in
[security.md](./security.md). Findings are rated by impact, not by CVSS.

The design is generally solid: HMAC agent tokens are tunnel/purpose/time-bound
and verified in constant time, WorkOS access tokens are JWKS-verified with issuer
and `client_id` checks, org membership is re-checked server-side on every
authenticated call, internal `x-mtunnel-*` headers are stripped from public
input, and structured logs deliberately omit secrets. The items below are
refinements, not a contradiction of that baseline.

---

## Security

### S1. Reflective CORS with credentials is broad when `--allow-cors` is on — Medium

`apps/api/src/routes/(tunnel)/proxy.ts:104` (`withCors`) and `:118`
(`preflightResponse`) reflect the caller's `Origin` and set
`access-control-allow-credentials: true` for any origin whenever the agent
enabled CORS. `preflightResponse` also reflects `access-control-request-method`
and `access-control-request-headers` verbatim.

When a developer runs with `--allow-cors`, any website the developer visits can
issue credentialed cross-origin requests to the tunneled app and read the
responses. This is opt-in and matches the documented "public tunnel" model, but
it is stronger than most people expect from a flag named "allow CORS".

Recommendation: document the flag's blast radius explicitly, and consider
supporting an allowlist of origins instead of unconditional reflection.

### S2. Authenticated API endpoints are not rate-limited — Low/Medium

Only `/api/v1/auth/*` (`AUTH_RATE_LIMITER`) and the proxy path
(`PROXY_RATE_LIMITER`) are limited (`apps/api/wrangler.jsonc:32`). Authenticated
endpoints — token mint, domain add/verify/status, preview create/upload,
organization create — have no limiter. `handleDomainAction` verify/status
(`packages/core/src/domains.ts:326`, `:351`) triggers outbound Cloudflare API and
DNS-over-HTTPS calls, so an authenticated user can drive amplified upstream load
and Cloudflare API quota consumption.

Recommendation: add a per-user/per-org limiter to the authenticated surface,
especially the domain verify path.

### S3. Global `RegistryDO` is a correctness and availability chokepoint — Medium

Every tunnel ownership check, claim, and connection-count update routes through a
single Durable Object named `"global"` (`env.REGISTRY.getByName("global")`,
used in `apps/api/src/routes/(tunnel)/proxy.ts:41`, `.../(api)/tunnels.ts:15`,
`registry-do.ts`). Beyond the scaling note in O6, this is also a security-relevant
single point: connection-limit enforcement (`acquireConnection`,
`registry-do.ts:21`) and org ownership all depend on this one object staying
available and consistent. Contention or an outage here degrades authorization,
not just throughput.

Recommendation: shard ownership by tunnel-id-derived DO name; keep only truly
global counters (if any) in a single object.

### S4. Preview upload trusts client-declared `sha256` without verification — Low

`handlePreviewUpload` (`apps/api/src/routes/(api)/previews.ts:268`) and the core
`upload` (`packages/core/src/previews.ts:287`) pass the manifest's `sha256` to
`R2.put({ sha256 })`, which makes R2 reject a mismatched body — good. But the
size gate only checks the `content-length` header equals the declared size
(`previews.ts:285`); a client can still stream a body of a different actual
length up to R2's own limits if it lies about `content-length`. Integrity is
enforced by the sha256 check, so this is low impact, but the size accounting used
for quota (`total_bytes`) is client-asserted at create time and never reconciled
against bytes actually stored.

Recommendation: treat manifest sizes as advisory; enforce the real per-file cap
at the R2 layer, and consider reconciling stored bytes against the quota.

### S5. `completeLogin` performs the authorization-code exchange without PKCE — Low

`apps/dashboard/src/server/auth.ts:47` verifies the `state` cookie (good CSRF
defense) but the `authorization-code` grant in
`packages/core/src/workos.ts:129` sends no `code_verifier`. `beginLogin`
(`auth.ts:32`) likewise sets no `code_challenge`. The flow is server-side and
state-protected, so risk is limited, but PKCE is cheap defense-in-depth against
code interception/injection.

Recommendation: add PKCE (`code_challenge` on authorize, `code_verifier` on
exchange). The core `WorkosGrant` already carries an optional `codeVerifier`.

### S6. Dashboard session cookie stores long-lived WorkOS refresh tokens — Low

The `mt_session` cookie is a base64url JSON blob (access + refresh token, email,
org) HMAC-signed with `SESSION_SECRET` (`apps/dashboard/src/server/session.ts:78`).
It is signed but not encrypted, so anyone who can read the cookie value (e.g. a
memory/log disclosure, or a future non-HttpOnly regression) obtains a usable
30-day WorkOS refresh token. The attributes are correct today (HttpOnly, Secure,
SameSite=Lax, 30-day). Consider encrypting the payload (AES-GCM) so the tokens
are never present in plaintext at rest in the browser, and shortening the cookie
lifetime relative to the refresh-token lifetime.

### S7. `verify` reason codes distinguish `bad_signature` vs `expired` vs `tunnel_mismatch` — Informational

`packages/core/src/agent-tokens.ts:123` returns granular failure reasons. The
caller (`forwardConnect`, `proxy.ts:40`) correctly collapses all of them to a
generic 401, so nothing leaks to clients. Keep it that way — do not surface the
specific reason in any HTTP response or client-visible log.

---

## Optimization

### O1. `escapeHTML` allocates a new `Map` per character — Low, easy win

`apps/api/src/routes/(preview)/serve.ts:37` builds a fresh 5-entry `Map` inside
the `replace` callback, i.e. once per matched character. Hoist the map (or a plain
object/switch) to module scope.

### O2. Domain `list` / `verifyOrStatus` write to D1 on every read — Low/Medium

`packages/core/src/domains.ts:388` (`list`) issues an unconditional
`UPDATE custom_domains SET organization_id = ? ... WHERE organization_id = ?`
(legacy migration) on every list call, and `migrate` (`domains.ts:192`) does the
same per verify/status. These are write operations on a read path and run even
when there is nothing to migrate.

Recommendation: gate the migration behind a cheap check (only run when a
legacy-owned row is actually found), or drop it once legacy data is migrated.

### O3. HMAC `CryptoKey` re-imported on every sign/verify — Low

`agent-tokens.ts:51` (`hmacKey`) and `session.ts:78`/`:99` call
`crypto.subtle.importKey` on every mint, verify, and session read/write. The key
is derived from a stable secret. Cache the imported `CryptoKey` per secret at
module scope to avoid repeated key import on hot paths.

### O4. In-memory `offlineUntil` map is never garbage-collected — Low

`proxy.ts:10` keys short-lived offline markers by `host:tunnelId`. Entries are
deleted only when the same key is requested again after expiry
(`proxy.ts:162`); a tunnel that goes offline and is never hit again leaves a
stale entry for the isolate's lifetime. Unbounded in theory. Consider an
occasional sweep or a small bounded LRU.

### O5. `previewID`/`previewId` are duplicated verbatim — Low, maintainability

The base32 id generator exists in both `apps/api/src/routes/(api)/previews.ts:79`
and `packages/core/src/previews.ts:67`, along with duplicated `validFile` /
`isPreviewPath` logic that also overlaps `packages/core/src/schemas.ts`. The API
route layer and the core service reimplement much of the same preview logic.
Consolidate on the `@tunnel/core` implementation to prevent the two copies from
drifting (they already differ subtly in limit handling).

### O6. `connectedSocket()` deserializes attachments repeatedly — Low

`tunnel-do.ts:284` scans `getWebSockets()` and deserializes each attachment on
every call, and it is called from `corsEnabled`, `handleProxy`, `status`, and
usage recording. With auto-response ping/pong and hibernation the socket set is
tiny (0–1), so impact is small, but caching the active socket reference in the DO
instance would remove per-request deserialization.

### O7. Duplicated session/base64url/`isRecord` helpers across boundaries — Low

`base64Url`/`decodeBase64Url`/`isRecord`/`nonEmptyString`/`workosSession` are
duplicated between `apps/dashboard/src/server/session.ts` and `.../auth.ts`, and
base64url encode/decode is reimplemented again in `agent-tokens.ts` and
`domains.ts`. A shared util would shrink surface area and reduce the chance of an
encoding bug in one copy only.

---

## Suggested priority

1. S3 / O6 — reconsider the single global `RegistryDO` (correctness + scale).
2. S1 — document and optionally scope `--allow-cors`.
3. S2 — rate-limit the authenticated + domain-verify surface.
4. O2, O1, O3 — cheap, isolated performance fixes.
5. S5, S6 — auth hardening (PKCE, encrypt session payload).
6. O5, O7 — de-duplicate preview and session helpers.

_No secrets, destructive actions, or exploit code are included here. All findings
are within the authorized review of this repository._
