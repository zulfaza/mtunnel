# Implementation Plan & Status

mtunnel — a Cloudflare-native development tunnel (ngrok-style): expose a local HTTP
server through a public URL, streamed over a persistent WebSocket between a
Cloudflare Worker + Durable Object and a Go agent.

This document is the handoff source of truth: the phased plan, the current status of
every step, and the design decisions that are already locked in. Read
[protocol.md](./protocol.md) for the wire format — it is normative and implemented.

**Last updated:** 2026-07-10 (end of Phase 6)

## Status overview

| Phase | Scope                              | Status            |
| ----- | ---------------------------------- | ----------------- |
| 1     | Monorepo scaffolding & tooling     | ✅ Done, verified |
| 2     | Wire protocol (TS + Go + fixtures) | ✅ Done, verified |
| 3     | Edge: Worker, Durable Object, auth | ✅ Done, verified |
| 4     | Go agent CLI                       | ✅ Done, verified |
| 5     | End-to-end integration tests       | ✅ Done, verified |
| 6     | Hardening & documentation          | ✅ Done, verified |

"Verified" means all of the following passed at the end of the phase, run from the
repo root: `pnpm lint`, `pnpm format --check`, `pnpm typecheck`, `pnpm build`,
`pnpm test`, `pnpm build:agent`, and `go test ./... && go vet ./...` in
`agents/tunnel`.

Git note: the worktree is intentionally **not committed** and contains both staged
and unstaged work — the repo owner decides when to stage and commit.

## Architecture (fixed)

```
Internet → Cloudflare Worker → Durable Object (one per tunnel, resolved via
env.TUNNELS.getByName(tunnelId)) → persistent WebSocket → Go agent → localhost
```

No global coordinator, no external database, no Redis, no Queues, no R2, no KV, no
Cloudflare Containers, **no caching layer** (never call the Cache API). Target cost:
Workers Paid plan, under USD $8/month for light personal use.

## Locked-in design decisions

These were decided during Phases 1–2 and later phases must follow them:

- **Protocol v1** — 22-byte binary header (version `0x01`, frame type, 16-byte
  request id, uint32 BE payload length), max payload 262,144 bytes, one WebSocket
  message = exactly one frame, JSON metadata / raw-byte bodies, headers as ordered
  `[name, value]` pairs to preserve duplicates (Set-Cookie). Full spec:
  [protocol.md](./protocol.md).
- **Auth token** — `base64url(claimsJSON) + "." + base64url(HMAC-SHA256(rootSecret,
base64url(claimsJSON)))`. Claims: `{sub, tunnelId, purpose: "agent", iat, exp}`,
  TTL 900 s (`TOKEN_TTL_SECONDS` in `@tunnel/config`). Validate signature
  (constant-time), expiry, tunnelId match, and `purpose === "agent"`. The root
  secret is the Worker secret `AUTH_SECRET`. Never log tokens or secrets.
- **Token flow** — `mt login` stores server URL + auth secret in the agent
  config file; the agent exchanges the secret for a fresh short-lived token via
  `POST /api/v1/auth/token` on **every** (re)connect.
- **Credential transport** — short-lived connect tokens use the WebSocket
  `Authorization: Bearer` header, never URL query parameters. Tunnel status also
  requires the root secret. Authorization is stripped before DO forwarding.
- **Heartbeat is agent-initiated** — agent sends `Ping` every
  `heartbeatIntervalMs` (announced in `HelloAck`); the DO replies `Pong` from its
  `webSocketMessage` handler and keeps **no timers**, so idle tunnels can use
  Durable Object WebSocket **hibernation**. Agent reconnects if no `Pong` within
  `heartbeatTimeoutMs`.
- **One agent per tunnel** — a new agent WebSocket replaces the existing one; the
  old socket is closed with code `4001`.
- **`HelloAck` carries `publicUrl` and all limits** (heartbeat interval/timeout,
  request timeout, max payload) so the CLI banner and cadence are server-driven.
- **Error mapping** — request timeout → `504`; other proxy/upstream failures
  (agent offline, malformed frames, upstream error) → `502`; too many pending
  requests → `503`. API endpoints return JSON errors. Never expose stack traces.
- **Cache disabled unconditionally** — every proxied response gets
  `Cache-Control: no-store, no-cache, must-revalidate, private`,
  `Pragma: no-cache`, `Expires: 0`, overriding upstream values. Document the
  required Cloudflare dashboard cache-bypass rule in deployment docs.
- **Routing** — production: wildcard host `<tunnelId>.<TUNNEL_DOMAIN>`; local dev:
  path prefix `/t/<tunnelId>/*` enabled only when `DEV_ROUTING=true`. API routes
  (`/health`, `/api/v1/...`) live on the Worker's own hostname.
- **Tunnel id** — must match `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`
  (`isValidTunnelId` in `@tunnel/shared`).
- **Limits** — defaults live in `@tunnel/config`: request timeout 30 s, max 32
  pending requests, max request 50 MiB, max response 100 MiB, heartbeat 20 s
  interval / 60 s timeout. All overridable via Worker vars; fail explicitly when
  exceeded; never buffer whole bodies (stream in ≤256 KiB frames).
- **Reconnect** — exponential backoff 500 ms → 30 s max, reset after a successful
  connection.
- **Tooling** — Oxlint + Oxfmt only (config in `.oxlintrc.json`; note the leading
  dot — the undotted name is silently ignored by oxlint). No ESLint/Prettier.
  Strict TypeScript (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `useUnknownInCatchVariables`), no `any`. Go: stdlib + Cobra +
  `coder/websocket` + `slog` only.

## Phase 1 — Scaffolding ✅

All done and verified:

- [x] pnpm workspaces (`apps/*`, `packages/*`) + Turborepo (build/test/lint/typecheck cached)
- [x] Root scripts: `dev`, `build`, `test`, `lint`, `format` (oxfmt, `--check` passes through), `typecheck`, `dev:edge`, `test:edge`, `build:agent`, `test:agent`
- [x] `packages/tsconfig` (`@tunnel/tsconfig/base.json`, all strict flags)
- [x] `packages/config` — default limits and TTL constants
- [x] `packages/shared` — `TUNNEL_ID_PATTERN`, `isValidTunnelId`
- [x] `apps/edge` — minimal Worker with `GET /health` → `{"status":"ok"}`, wrangler.jsonc (name `tunnel-edge`, compat date 2026-07-01, observability), `.dev.vars.example` (`AUTH_SECRET=development-token`, `DEV_ROUTING=true`, `TUNNEL_DOMAIN=tunnel.example.com`)
- [x] `agents/tunnel` — Go module `github.com/zulfaza/mtunnel/agents/tunnel` (go 1.25), Makefile (build/test/vet/clean), placeholder `main.go`
- [x] `.editorconfig`, `.gitignore`, `.env.example`, stub `README.md`

Notes for successors: `pnpm-workspace.yaml` has `onlyBuiltDependencies`
(esbuild/sharp/workerd) so `pnpm install` runs unattended;
`@cloudflare/workers-types` is `^5` (wrangler 4 peer dep).

## Phase 2 — Protocol ✅

All done and verified:

- [x] TypeScript codec in `packages/protocol` (`encodeFrame`/`decodeFrame`, typed `Message` union with `encodeMessage`/`decodeMessage`, `ProtocolError` codes, `chunkPayload`, request-id helpers; zero runtime deps, Workers-safe)
- [x] Go codec in `agents/tunnel/internal/protocol` (mirrors TS exactly; stdlib only)
- [x] Cross-language fixtures `packages/protocol/fixtures/frames.json` — 15 valid + 4 invalid cases; generator in `packages/protocol/scripts/gen-fixtures.mjs`
- [x] Both suites decode/roundtrip every fixture: 71 vitest tests, Go fixture + unit tests, all green
- [x] `packages/config` re-exports `MAX_FRAME_PAYLOAD_BYTES` from `@tunnel/protocol` (protocol owns frame constants)
- [x] [docs/protocol.md](./protocol.md)

## Phase 3 — Edge (Worker + Durable Object) ✅

Done and verified in `apps/edge/src/{auth,durable-objects,routing,utils}`:

- [x] `POST /api/v1/auth/token` — authenticated by `Authorization: Bearer <AUTH_SECRET>`; body `{tunnelId, sub?}`; validates tunnel id; returns `{token, tunnelId, expiresAt}`
- [x] `GET /api/v1/tunnels/:id/connect` — WebSocket upgrade; validates token (sig/exp/tunnel/purpose); forwards to the tunnel's DO
- [x] `GET /api/v1/tunnels/:id/status` — `{tunnelId, connected, connectedAt?, pendingRequests, lastHeartbeatAt?}`
- [x] `GET /health`
- [x] `TunnelDO` Durable Object: hibernation API, Hello→HelloAck handshake, replace-on-reconnect, Ping→Pong, metadata-only persistence
- [x] Proxy path: multiplexed requests, chunked request streaming, streamed responses, header sanitization/forwarding, unconditional no-store cache headers
- [x] Timeout (504), client disconnect cancellation, pending limit (503), agent offline (502)
- [x] Wrangler DO binding/migration, placeholder wildcard route, and vars for all limits
- [x] Worker-pool tests: auth, routing, cache headers, timeout/pending limit, multiplexing, and fake-agent lifecycle (16 tests); real client cancellation is covered by Phase 5 E2E

## Phase 4 — Go agent ✅

Done and verified in `agents/tunnel/{cmd,internal/{agent,auth,client,config,proxy}}`:

- [x] Cobra CLI, binary `mt`: `login`, `http <port>`, `status`, `version`
- [x] Flags: `--server`, `--token`, `--config`, `--hostname`, `--name`, `--request-timeout`, `--log-level`
- [x] `login` — prompt for server + secret, verify by minting a token, save config with mode 0600
- [x] `http` — random/explicit name, token minting, WebSocket Hello/HelloAck, server-driven public URL banner
- [x] Proxy — goroutine per request, `io.Pipe` streaming, bounded body channel, cancellation
- [x] Reconnect with backoff and token re-mint, agent Ping heartbeat, graceful signal shutdown
- [x] Structured `slog` request lifecycle logging without sensitive request data
- [x] Tests: reconnect, heartbeat timeout, proxy streaming, cancellation, timeout, auth, and config; direct flags also work without a pre-existing config file

Phases 3 and 4 touch disjoint directories and may be implemented in parallel.

## Phase 5 — Integration ✅

- [x] `scripts/e2e.mjs` + `pnpm test:e2e`: build/start the agent, `wrangler dev`, and a local HTTP fixture server with isolated ports and cleanup
- [x] Verified concurrent requests, 700 KB streaming in both directions, duplicate Set-Cookie preservation, no-store cache headers, client cancellation, timeout, and agent reconnect/token re-mint after a Worker restart

## Phase 6 — Hardening & docs ✅

- [x] Reviewed memory bounds, tunnel/hostname/token/size/pending validation, upstream isolation, and logging redaction
- [x] Hardened credential transport (WebSocket Authorization header, no query tokens), authenticated status access, and converted status to Durable Object RPC
- [x] Full `README.md` with local/login/http quick starts and expected banner
- [x] `docs/architecture.md` (Mermaid), `docs/development.md`, `docs/deployment.md` (secrets, wildcard DNS/routes, mandatory cache bypass), `docs/security.md`, `docs/troubleshooting.md`
- [x] Corrected aggregate body-limit documentation and completed the final verification sweep
- [x] [implementation-report.md](./implementation-report.md) with features, verification, limitations, deployment summary, and future improvements

## Out of scope (do not build)

TCP/UDP/SSH tunnels, custom domains, dashboard, teams, analytics, traffic
replay, request inspector, multiple agents per tunnel, Cloudflare Containers, any
caching.

## Verification commands (run after every phase)

```bash
pnpm install
pnpm lint
pnpm format --check
pnpm typecheck
pnpm test
pnpm build
pnpm build:agent
pnpm test:agent
cd agents/tunnel && go test ./... && go vet ./...
```
