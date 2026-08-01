# Effect migration & dashboard rework plan

> Status: completed 2026-08-01. Verification gates passed for core, protocol,
> API, and dashboard typecheck/build/test suites; Go CLI tests remain green.

Multi-phase plan to (1) migrate the TypeScript workspaces to
[Effect](https://effect.website), (2) move functions shared by the API and
dashboard into a workspace package, (3) make the dashboard read Cloudflare data
directly through its own bindings with its own auth, and (4) bring the
dashboard to 1:1 CLI feature parity (except starting a tunnel).

Written for an executing agent. Each phase is an independent PR with its own
verification gate. Do the phases in order — later phases assume earlier ones.

Reference implementations (canonical style, read before writing code):

- `/Users/zul/Developer/Repositories/Resources/t3code` — especially
  `infra/relay/src/worker.ts` (Effect on Cloudflare Workers, 307 lines),
  `packages/contracts/src/relay.ts` (schemas + tagged errors),
  `infra/relay/src/environments/EnvironmentLinks.ts` (service end-to-end),
  `.repos/effect-smol/LLMS.md` (the style bible — read lines 14–215 first).
- `/Users/zul/Developer/Repositories/Resources/opencode` — especially
  `packages/core/src/effect/runtime.ts` (lazy `ManagedRuntime` facade),
  `packages/core/src/pty/ticket.ts` (small complete service),
  `packages/protocol/src/errors.ts` (error catalogue), `AGENTS.md`.
- `/Users/zul/Developer/Repositories/Resources/effect` — the library source
  (v4). Use it, not memory, for API signatures.

## Decisions (defaults chosen; flag before deviating)

| #   | Decision                    | Choice                                                                                                                                                 | Rationale                                                                                                                                                                                                                                                |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Effect version              | `effect@4.0.0-beta.102`, pinned via pnpm catalog                                                                                                       | Both reference repos are v4 beta; v3 idioms (`Effect.Service`, `Context.Tag`, `@effect/schema`, `@effect/platform`) do not appear in them and would not match "proper implementation". Pin exactly; never `^`.                                           |
| D2  | API HTTP layer              | Keep the hand-rolled router in `apps/api`; handlers become Effects run through a cached runtime                                                        | The worker multiplexes 4 surfaces by hostname (site, API, preview host, tunnel wildcard) and passes through WebSocket 101 upgrades — `HttpApiBuilder` fits none of that without fighting it. Contract-first `HttpApi` can be a later, separate decision. |
| D3  | Tunnel hot path             | `TunnelDO`, `RegistryDO`, and `forwardProxy` internals stay imperative                                                                                 | Streaming/hibernation/byte-protocol code; AGENTS.md mandates performance and reliability first. References keep pure/hot code sync too ("Do not return Effect from helpers unless they actually perform effectful work" — opencode AGENTS.md).           |
| D4  | Dashboard client state      | Plain React + TanStack Start server functions; Effect lives in the dashboard's server half                                                             | `@effect/atom-react` is another beta dependency and a full client rewrite; server functions already give loaders/mutations. Revisit if client state grows.                                                                                               |
| D5  | `apps/landing`              | Out of scope for Effect                                                                                                                                | SvelteKit marketing site, ~505 LOC, one static-metadata TS file. Nothing to migrate.                                                                                                                                                                     |
| D6  | `packages/config`           | Stays constants-only                                                                                                                                   | No logic.                                                                                                                                                                                                                                                |
| D7  | API surface after migration | CLI-only: remove `/api/v1/auth/code`, `/api/v1/auth/client`, and dashboard CORS from `apps/api` (Phase 6, after the dashboard no longer calls the API) | User requirement: "just use api for cli".                                                                                                                                                                                                                |
| D8  | Dashboard preview upload    | In scope (Phase 6)                                                                                                                                     | Parity excludes only "running new tunnel"; `mt preview <path>` upload is included.                                                                                                                                                                       |

## Hard constraints (do not break)

1. **CLI wire compatibility.** The Go CLI is not changing. Every endpoint it
   calls must keep its path, method, auth header behavior
   (`Authorization: Bearer` + `X-Organization-Id`), response JSON shape, and
   the exact `{ "error": "<code>" }` codes + HTTP statuses:
   - 401 `unauthorized`, 403 `forbidden`, 503 `organization_unavailable`,
     400 `bad_request`, 404 `not_found`, 429 `rate_limited`
   - `POST /api/v1/auth/token`: 409 `tunnel_name_taken`, 500 `server_misconfigured`
   - domains: 409 `custom_domain_limit_reached`, 409 `domain_or_tunnel_taken`,
     409 `dns_verification_pending` (body also carries `message` and `domain`
     view), 502 `custom_domain_provision_failed`, 502
     `custom_domain_delete_failed`, 502 `domain_storage_failed`, 503
     `custom_domains_not_configured`
   - previews: 413 `preview_limit_exceeded`, 500 `invalid_manifest`
   - organizations: 502 `organization_create_failed`
   - connect: 426 `upgrade_required`, 429 `active_tunnel_limit_reached`
   - Error bodies for domain conflicts: `{error, message?, domain?}` exactly as
     `domainResponse()` builds them today (`apps/api/src/routes/(api)/domains.ts:26`).
2. **Protocol bytes are normative.** `packages/protocol` has a hand-written Go
   mirror (`apps/cli/internal/protocol`) and shared fixtures
   (`packages/protocol/fixtures/frames.json`). The codec stays synchronous and
   byte-identical; all fixture tests (71 TS + Go) must pass unchanged.
3. **Streaming discipline.** Never buffer request/response bodies; never call
   the Cache API; keep the unconditional no-store headers on proxied responses.
4. **No secrets in logs**; keep the existing redaction rules.
5. **Existing API vitest suite** (`apps/api/test/*`, Workers pool) tests HTTP
   behavior via `SELF.fetch` — it should pass with minimal edits. Treat it as
   the compatibility harness.

## Effect conventions to follow (from the reference repos)

- Services: `class X extends Context.Service<X, Shape>()("@tunnel/core/<path>/X") {}`
  with a separate `export const layer = Layer.effect(X, make)` (or
  `Layer.succeed` for value services). Parameterizable `make` so tests can
  build variants. Service shape type via `X["Service"]`.
- Every function that takes args and returns an Effect uses
  `Effect.fn("domain.action")(function* (...) {...})` — the name doubles as a
  tracing span. Standalone effects and layer bodies use `Effect.gen`.
  Combinators go in extra `Effect.fn` args, **not** `.pipe` on the fn.
- Errors: `Schema.TaggedErrorClass<E>()("Name", fields, { httpApiStatus })` for
  anything crossing a package/wire boundary; `Data.TaggedError` only for
  purely-internal errors. `cause: Schema.Defect()` to wrap unknown throwables.
- Schemas: `effect/Schema` everywhere untrusted input enters. Compile
  decoders **once at module scope** (`const decodeX = Schema.decodeUnknownEffect(X)`),
  never inside a function (hot-path allocation). Prefer
  `Schema.fromJsonString(X)` over `JSON.parse` + validate. Export a same-named
  type/interface next to every schema.
- Layer composition: `Layer.provideMerge` chains bottom-up; `Layer.mergeAll`
  for siblings; `Layer.unwrap` for config-dependent layers.
- Naming: `export const layer`, `layer<Variant>` for alternates; error classes
  `<Domain><Action><Kind>Error`; span names dot-namespaced lowercase.
- Imports: named imports from `"effect"` (opencode style — matches this repo's
  bundler moduleResolution and `.js`-extension relative imports). Never alias.
- Do **not** wrap pure sync helpers in Effect.

Version note: in v4 there is no `Effect.Service`, no `Context.Tag`, no
`@effect/schema`, no `@effect/platform` (HTTP lives in `effect/unstable/http`).
Checks are `.check(Schema.isX(...))`, literals are `Schema.Literals([...])`,
optional-and-omitted keys are `Schema.optionalKey`. Verify signatures against
`/Users/zul/Developer/Repositories/Resources/effect/packages/effect/src`.

---

## Phase 1 — `@tunnel/core` scaffold: schemas, errors, binding services

New workspace package `packages/core` (`@tunnel/core`), built like
`packages/protocol` (tsc → `dist`, `@tunnel/tsconfig/base.json`, oxlint,
vitest). Root `tsconfig.json` gains a project reference. `pnpm-workspace.yaml`
gains:

```yaml
catalog:
  effect: 4.0.0-beta.102
```

Dependencies: `effect: catalog:`, `jose ^6`, `@tunnel/config workspace:*`;
dev: `@cloudflare/workers-types ^5`.

Files:

- `src/schemas.ts` — `TunnelId` (branded pattern schema + `isValidTunnelId`),
  `isValidHostname`, `PreviewVisibility`, `AccessCode` (4–128 chars),
  `PreviewFile` (path validation, sha256 regex), `PreviewView`, `DomainStatus`,
  `DomainView`, `TunnelStatusView`, `OrganizationMembershipView`,
  `OrganizationLimits`, request bodies (`TokenRequest`, `DomainAddRequest`,
  `OrganizationCreateRequest`, `PreviewCreateRequest`, `PreviewUpdateRequest`).
  Source of truth for shapes: `apps/api/src/{domains.ts,access.ts,routes/(api)/previews.ts,preview-access.ts,utils/tunnel-id.ts}`.
- `src/errors.ts` — tagged error catalogue mirroring the wire table above.
  Every class carries enough fields to render `{error, message?, domain?}`;
  give each a `status` and `code` (or a single exported
  `errorToResponseParts(e)` mapper). Suggested classes: `UnauthorizedError`,
  `ForbiddenError`, `OrganizationUnavailableError`, `BadRequestError`,
  `NotFoundError`, `RateLimitedError`, `TunnelNameTakenError`,
  `ActiveTunnelLimitError`, `UpgradeRequiredError`, `MisconfiguredError`,
  `DomainConflictError { code: Literals([...conflict codes]), message?, domain? }`,
  `DomainUpstreamError { code: Literals([...502 codes]), message? }`,
  `DomainsNotConfiguredError`, `PreviewLimitError`, `InvalidManifestError`,
  `OrganizationCreateError`.
- `src/bindings.ts` — value services over Cloudflare bindings, provided at each
  app's edge:
  - `DomainsDatabase` (shape: `D1Database`)
  - `PreviewBucket` (shape: `R2Bucket`)
  - `TunnelRegistry` — methods `claimTunnel`, `ownsTunnel`,
    `organizationForTunnel`, `acquireConnection`, `releaseConnection` returning
    Effects (wrap the DO stub promises with `Effect.promise`; stub failures are
    defects, matching today's throw-→-500 behavior). Define a structural
    `RegistryStub` interface so the dashboard's untyped cross-script stub can
    be adapted with one cast.
  - `Tunnels` — `status(tunnelId)`, `corsEnabled(tunnelId)` over a structural
    `TunnelStub`.
- `src/config.ts` — `CoreConfig` value service: `tunnelDomain`,
  `previewDomain`, `customDomainCname`, `workosClientId`, and optional
  `workosApiKey`, `cloudflareApiToken`, `cloudflareZoneId`, `authSecret`,
  `authMode`, `devAuthSecret`, `posthogApiKey`, `posthogHost`, preview limit
  overrides. Both apps build it from their env vars.
- `src/runtime.ts` — `makeCoreLayer(bindings, config)` returning the merged
  layer, plus a lazy cached `ManagedRuntime` helper modeled on opencode's
  `packages/core/src/effect/runtime.ts` (cache per isolate: Workers env is
  stable across invocations; build on first request, reuse after).
- `src/index.ts` — namespace re-exports (`export * as Previews from ...`).

No consumers yet. Gate: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`.

## Phase 2 — `@tunnel/protocol` Effect adoption (codec stays sync)

- `src/errors.ts`: `ProtocolError` becomes
  `class ProtocolError extends Data.TaggedError("ProtocolError")<{ code: ProtocolErrorCode; message: string }>`
  (internal error that never serializes to clients — `Data.TaggedError` is the
  reference-sanctioned choice there). Keep the `code` union unchanged.
  `instanceof ProtocolError` call sites keep working.
- `src/messages.ts`: replace the hand-rolled `requireString/Number/Boolean/...`
  JSON validation with `effect/Schema` structs per frame kind
  (`HelloPayload`, `HelloAckPayload`, `RequestStartPayload`,
  `ResponseStartPayload`, `CancelPayload`, `ErrorPayload`), compiled once at
  module scope with `Schema.decodeUnknownSync` (the codec API stays sync —
  callers are the DO hot path and tests). Map `ParseError` →
  `ProtocolError("invalid_json", ...)` so error codes stay identical.
- `frame.ts`, `chunk.ts`, `request-id.ts`: unchanged (pure, hot).
- `package.json`: add `effect: catalog:`.

Gate: all protocol vitest tests pass unchanged (error `code` assertions
included); `cd apps/cli && go test ./...` still green (fixtures untouched);
`pnpm test:e2e`.

## Phase 3 — port shared domain logic into `@tunnel/core`

Move (not duplicate) the API's domain logic into core services. The API keeps
compiling against its old modules until Phase 4 swaps it over — so land this
phase as pure addition, with unit tests, then Phase 4 deletes the originals.

| Core service                                     | Ported from                             | Notes                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Workos` (`src/workos.ts`)                       | `apps/api/src/auth/workos.ts`           | `verifyAccessToken` (jose `createRemoteJWKSet`, cache per clientId at module scope), `request(path, init)` (REST with `WORKOS_API_KEY`), `form(path, params)`, `authenticate(grant)` covering device / device-token / refresh / authorization-code grants. Grant methods return the upstream `Response` untouched (the API proxies WorkOS bodies verbatim and the CLI parses them). |
| `Organizations` (`src/organizations.ts`)         | `apps/api/src/auth/organizations.ts`    | `ensureForUser`, `listForUser`, `forMember`, `createForUser`. Replace the manual `parseUser`/`membershipOrganizationId`/... unknown-poking with module-scope compiled schemas. Keep the public-email-domain set, invitation and verified-domain auto-join logic, and the `ztunnel-user:<id>` external-id fallback exactly.                                                          |
| `Authentication` + `CurrentUser` (`src/auth.ts`) | `apps/api/src/auth/workos.ts:55`        | `authenticate({ bearer, organizationId })` → `CurrentUser { userId, organizationId }`, failing with `UnauthorizedError` / `ForbiddenError` / `OrganizationUnavailableError`. Includes the `AUTH_MODE=development` + `DEV_AUTH_SECRET` bypass (timing-safe compare). Both API (headers) and dashboard (session cookie) feed it.                                                      |
| `AccessLimits` (`src/access.ts`)                 | `apps/api/src/access.ts`                | `limitsForOrganization`; keep RESTRICTED/UNRESTRICTED tables verbatim.                                                                                                                                                                                                                                                                                                              |
| `AgentTokens` (`src/agent-tokens.ts`)            | `apps/api/src/auth/index.ts`            | `mint(tunnelId, sub)`, `verify(token, expectedTunnelId)` (HMAC-SHA256, `TOKEN_TTL_SECONDS`), plus exported pure `timingSafeSecretEqual`. Preserve the exact base64url token format — outstanding CLI tokens must stay valid.                                                                                                                                                        |
| `CustomDomains` (`src/domains.ts`)               | `apps/api/src/domains.ts`               | All of add/verify/status/list/delete/markUsed/tunnelIdForDomain including the pending-domain reaping, legacy `owner_id` migration path, the quota-guarded INSERT, DoH TXT verification, and Cloudflare custom-hostnames API calls. `DomainResult` unions become success values + tagged errors.                                                                                     |
| `Previews` (`src/previews.ts`)                   | `apps/api/src/routes/(api)/previews.ts` | create/update/upload/list/delete/cleanupExpired + `findForServing(id)`. Upload keeps streaming `request.body` → `PREVIEWS.put(key, body, { sha256 })` — pass the stream through, never read it.                                                                                                                                                                                     |
| `PreviewAccess` (`src/preview-access.ts`)        | `apps/api/src/preview-access.ts`        | Access-code hash/verify, signed cookie value/name, `cookieValue` parser. Pure/async helpers, not a service.                                                                                                                                                                                                                                                                         |
| `Analytics` (`src/analytics.ts`)                 | `apps/api/src/analytics.ts`             | `capture(event)` → `Effect<void>` that never fails (log-and-swallow). Keep the PostHog payload shape and privacy filtering.                                                                                                                                                                                                                                                         |

Also port the pure utilities used by both apps: `tunnel-id` (already in
schemas), hostname validation, `routing` host/path parsing if the dashboard
needs it (it doesn't — leave `routing/` in the API).

Tests: port `apps/api/test/{access,organizations,workos}.test.ts` logic to core
unit tests (plain vitest + `Layer.succeed` fakes; no Workers pool needed for
WorkOS/limits logic — D1-dependent tests can stay in the API suite until Phase 4).

Gate: `pnpm build && pnpm typecheck && pnpm lint && pnpm test` (api suite still
green and still on its own modules).

## Phase 4 — `apps/api` on Effect

- `src/runtime.ts` (new): build the core layer from `Env` once per isolate
  (lazy module-level cache) → `ManagedRuntime`. Bindings layers wrap
  `env.DOMAINS`, `env.PREVIEWS`, `env.REGISTRY.getByName("global")`,
  `env.TUNNELS`.
- Rewrite `routes/(api)/*` handlers as `Effect.fn("api.<area>.<action>")`
  functions that yield core services and return plain response values; one
  adapter maps success → `jsonResponse` and the tagged-error union → the
  wire table (this adapter is the single place the compat table lives).
  Request-body parsing via core schemas (`Schema.decodeUnknownEffect`,
  compiled at module scope) with `ParseError → BadRequestError`.
- `routes/(api)/index.ts` keeps the fast if-chain dispatch; each branch becomes
  `runtime.runPromise(handler(request, ...))`.
- `forwardConnect` (`routes/(tunnel)/proxy.ts:22`) becomes an Effect
  (verify token → registry claim/limits → acquire → DO fetch via
  `Effect.tryPromise` with release on failure). The 101 response passes
  through `runPromise` fine. `forwardProxy`, the offline cache map, and both
  DOs stay as they are, except: `TunnelDO`/`RegistryDO` may keep calling
  `capture()` directly — expose a thin promise wrapper from core analytics for
  DO call sites rather than dragging a runtime into the DO.
- Preview serving (`routes/(preview)/serve.ts`) and the cron switch to core
  `Previews`/`PreviewAccess` (serving can be an Effect handler — it's not the
  tunnel hot path — but keep the R2 body streaming untouched).
- Delete the superseded modules: `src/auth/*`, `src/access.ts`,
  `src/domains.ts`, `src/preview-access.ts`, `src/analytics.ts`, and the
  validation halves of `routes/(api)/*`. `src/utils/{headers,logging}.ts` stay
  (protocol/proxy concerns). **Do not remove** `/api/v1/auth/code`,
  `/api/v1/auth/client`, or CORS yet — the deployed dashboard still uses them
  until Phase 5 ships.
- `AGENTS.md`: add the Effect conventions section (service/error/schema rules
  above) so future work stays consistent.

Gate: full `apps/api` vitest suite (expect small edits where tests import
internal modules — e.g. `test/workos.test.ts` imports move to `@tunnel/core`),
`pnpm build`, `pnpm test:e2e`, and a manual smoke of `mt login && mt http` +
`mt domain list` + `mt preview` against `wrangler dev`.

## Phase 5 — dashboard: direct bindings + own auth

**Bindings** (`apps/dashboard/wrangler.jsonc`):

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "TUNNELS", "class_name": "TunnelDO", "script_name": "mtunnel-api" },
    { "name": "REGISTRY", "class_name": "RegistryDO", "script_name": "mtunnel-api" }
  ]
},
"d1_databases": [
  { "binding": "DOMAINS", "database_name": "mtunnel-domains",
    "database_id": "d73b0447-a7ec-47c8-a804-30578f053b7c" }
],
"r2_buckets": [{ "binding": "PREVIEWS", "bucket_name": "mtunnel-previews" }],
"vars": {
  "TUNNEL_DOMAIN": "makarima.xyz",
  "PREVIEW_DOMAIN": "preview.makarima.xyz",
  "CUSTOM_DOMAIN_CNAME": "cname.makarima.xyz",
  "WORKOS_CLIENT_ID": "client_01K65Z0KMSGX9H9XQDN5TECBYD"
}
// secrets: WORKOS_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, SESSION_SECRET
```

Notes: cross-script DO bindings require the `mtunnel-api` worker deployed in
the same account; D1 migrations continue to run only from the API deploy. For
local dev, run the API worker as an auxiliary worker alongside the dashboard
(`@cloudflare/vite-plugin` supports `auxiliaryWorkers` pointing at
`../api/wrangler.jsonc`) or develop dashboard features against remote bindings.

**Server runtime**: `src/server/runtime.ts` — `import { env } from "cloudflare:workers"`,
build the same core layer as the API (lazy, cached). Add
`effect`, `jose`, `@tunnel/core` to dashboard deps and generate `Env` types
with `wrangler types`.

**Auth (WorkOS, server-side, no API involvement)**:

- `GET /auth/login?screen=sign-in|sign-up` (server route): generate `state`,
  set it in a short-lived HttpOnly cookie, redirect to
  `https://api.workos.com/user_management/authorize` with
  `client_id`, `redirect_uri=https://app.<domain>/callback`,
  `response_type=code`, `provider=authkit`, `screen_hint`. Server-side code
  exchange uses the client secret, so PKCE is unnecessary — drop it.
- `GET /callback` (server route): verify `state` cookie, exchange the code via
  `POST https://api.workos.com/user_management/authenticate`
  (`grant_type=authorization_code`, `client_secret=WORKOS_API_KEY`) through the
  core `Workos` service, then set the session cookie and redirect to `/`.
- Session cookie `mt_session`: JSON `{accessToken, refreshToken, email,
organizationId?}`, base64url + HMAC-SHA256 signature with `SESSION_SECRET`,
  `HttpOnly; Secure; SameSite=Lax; Path=/`. (~1.5 KB, under cookie limits.)
- Session middleware for server functions: read cookie → verify the access
  token with core `Authentication`; on expiry, refresh via the core `Workos`
  refresh grant (single-flight per request), re-set the cookie; on refresh
  failure clear the cookie and surface "signed out".
- `POST /auth/signout`: clear cookie.
- Delete the client-side PKCE machinery (`src/lib/auth.ts`), the `/register`
  PKCE path, and `VITE_API_BASE` — the dashboard makes zero calls to
  `api.makarima.xyz` after this phase.
- WorkOS dashboard config: the existing `https://app.makarima.xyz/callback` +
  localhost redirect URIs already cover this flow.

**Data**: rewrite the assets page to a TanStack Start server function backed by
core `Previews` (list/update/delete), with route-level loader instead of
`useEffect`+`apiFetch`.

Gate: `pnpm typecheck && pnpm build && pnpm test`; manual: sign in, list/change
visibility/delete previews with the API worker stopped (proves no API
dependency); confirm session refresh works past token expiry (WorkOS access
tokens are short-lived).

## Phase 6 — dashboard feature parity + API slim-down

Parity matrix (CLI → dashboard):

| CLI                                 | Dashboard                                                                                                                                                                               | Backing                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mt login`                          | `/login` (Phase 5)                                                                                                                                                                      | WorkOS                                                                                                                                                    |
| `mt preview <path>`                 | Assets page: upload file(s)/directory (directory via `webkitdirectory` input), compute per-file SHA-256 in the browser (`crypto.subtle.digest`), create manifest, then upload each file | core `Previews.create` + a server **route** (not fn) `PUT /assets/upload/:id/*path` streaming `request.body` → `Previews.upload`; enforce the same limits |
| `mt preview list/visibility/delete` | Assets page (exists; done in Phase 5)                                                                                                                                                   | core `Previews`                                                                                                                                           |
| `mt domain add`                     | Domains page: add form (hostname + tunnel name), shows CNAME/TXT records                                                                                                                | core `CustomDomains.add`                                                                                                                                  |
| `mt domain list/detail`             | Domains page: table + detail drawer with DNS records                                                                                                                                    | `CustomDomains.list`                                                                                                                                      |
| `mt domain verify`                  | "Verify" action, surfacing `dns_verification_pending` message + records                                                                                                                 | `CustomDomains.verify`                                                                                                                                    |
| `mt domain status`                  | Status column with poll/refresh while `provisioning`                                                                                                                                    | `CustomDomains.status`                                                                                                                                    |
| `mt domain delete`                  | Delete action with confirm                                                                                                                                                              | `CustomDomains.delete`                                                                                                                                    |
| `mt org list`                       | Organization switcher (header)                                                                                                                                                          | `Organizations.listForUser`                                                                                                                               |
| `mt org create`                     | Create-organization dialog                                                                                                                                                              | `Organizations.createForUser`                                                                                                                             |
| `mt org use`                        | Switcher writes `organizationId` into the session cookie (membership-verified via `Organizations.forMember`)                                                                            | session                                                                                                                                                   |
| `mt status <id>`                    | Tunnels page: lookup by name → connected/connectedAt/pending/lastHeartbeat (ownership-checked)                                                                                          | `TunnelRegistry.ownsTunnel` + `Tunnels.status`                                                                                                            |
| `mt http`                           | **Excluded** (per requirements)                                                                                                                                                         | —                                                                                                                                                         |
| `mt version` / `mt update`          | N/A (CLI binary concerns)                                                                                                                                                               | —                                                                                                                                                         |

UI: follow the existing shell/table/dialog components and terminal-ish styling
(`apps/dashboard/src/components/*`). Keep pages thin; all logic in server
functions calling core services.

**API slim-down (same phase, after dashboard deploys)**: remove
`/api/v1/auth/code`, `/api/v1/auth/client`, `corsPreflight`/`withCors` and
`src/utils/cors.ts` from `apps/api`. Keep `device`, `device/token`, `refresh`,
`token` (CLI). Update `trackedApiEvent` accordingly.

Gate: dashboard build/tests; API suite (drop the removed-endpoint tests);
manual parity walkthrough of every row above; `mt` CLI smoke unchanged.

## Phase 7 — docs & final sweep

- `docs/architecture.md`: add `@tunnel/core`, Effect runtime note, dashboard
  direct-binding data path (dashboard no longer calls the API), updated
  public-applications section.
- `docs/development.md`: dashboard dev setup (auxiliary worker / remote
  bindings, `SESSION_SECRET` in `.dev.vars`), Effect conventions pointer.
- `docs/deployment.md`: dashboard secrets (`WORKOS_API_KEY`,
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `SESSION_SECRET`), deploy
  order (api before dashboard for DO classes), removal of dashboard CORS/API
  coupling.
- `docs/security.md`: dashboard session-cookie model; API is CLI-only.
- `docs/analytics.md`: any event changes (dashboard events now emitted from the
  dashboard worker if kept).
- Delete this plan file (or move to an archive section) once everything above
  is merged.
- Final sweep from repo root: `pnpm lint && pnpm format && pnpm typecheck &&
pnpm build && pnpm test && pnpm build:cli && pnpm test:cli && pnpm test:e2e`.

## Known gotchas for the executing agent

1. **Effect v4 beta churn** — pin exactly (catalog), do not let renovate/bump
   tooling touch it; consult the local effect repo source for signatures.
2. **`exactOptionalPropertyTypes`** is on: use `Schema.optionalKey` (omits the
   key) rather than `Schema.optional` (allows explicit `undefined`) to match
   existing `...(x === undefined ? {} : { x })` response building.
3. **Module-scope decoder compilation** — schema decode/encode allocate
   compiled functions; building them per-request is a hot-path regression
   (t3code lint rule `no-inline-schema-compile`).
4. **Workers + spans**: if tracing is added later, spans need
   `Effect.ensuring(Effect.yieldNow)`-style flushing before the isolate
   freezes (see t3code `infra/relay/src/http/Api.ts` comments). Not needed for
   this migration (no exporter), but don't add one casually.
5. **Cross-script DO bindings** return untyped stubs — adapt through the
   structural `RegistryStub`/`TunnelStub` interfaces in core with a single
   cast at the dashboard env boundary.
6. **Turbo build order**: `@tunnel/core` must build before api/dashboard
   typecheck (`dependsOn: ["^build"]` already handles it — just declare the
   workspace dependency).
7. **oxlint/oxfmt** run on all new code; run `pnpm format` before every commit
   (AGENTS.md).
8. **`RegistryDO.claimTunnel` legacy-user migration args** (`legacyUserId`)
   are load-bearing for pre-organization records — keep passing `userId`.
9. **Preview upload streaming**: `PUT` handlers must hand `request.body`
   directly to `R2Bucket.put` with `sha256` + `Content-Length` check; reading
   the stream first breaks the memory model.
10. **Don't rename workers** (`mtunnel-api`, `mtunnel-dashboard`) — DO state
    and routes are bound to the deployed names.

## Execution archive

- Phase 1: `@tunnel/core` scaffold, bindings, schemas, errors, config, runtime.
- Phase 2: Effect Schema protocol payload validation; synchronous codec and Go
  fixtures preserved.
- Phase 3: shared WorkOS, auth, organizations, limits, tokens, domains,
  previews, access, and analytics moved into core.
- Phase 4: API shared logic runs through the core runtime; CLI wire behavior
  verified by the existing API suite.
- Phase 5: dashboard direct D1/R2/DO bindings, server-side WorkOS exchange,
  signed sessions, refresh, and preview server functions.
- Phase 6: dashboard uploads, domains, organizations, tunnel status, and API
  CLI-only slim-down; dashboard auth endpoints and dashboard CORS removed.
- Phase 7: architecture, development, deployment, security, analytics, and
  Effect agent guidance updated.

Unresolved: production manual auth/refresh and cross-script binding smoke must
be run after deployment; no local development server was started per repository
instructions.
