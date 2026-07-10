# Implementation report

**Completed:** 2026-07-10  
**Status:** Phases 1–6 implemented and verified

## Delivered

- pnpm/Turborepo monorepo with strict TypeScript, Oxlint, and Oxfmt
- Byte-compatible protocol v1 codecs in TypeScript and Go with shared fixtures
- Cloudflare Worker routing, HMAC token minting/validation, authenticated status,
  and one hibernatable Durable Object per tunnel
- Multiplexed, bounded, streamed HTTP proxying with cancellation, timeouts,
  forwarding-header sanitation, and unconditional cache prevention
- Go Cobra agent with login, HTTP tunnel, status, version, heartbeat, reconnect,
  graceful shutdown, and structured request logs
- Worker-pool integration tests and a full local E2E lifecycle orchestrator
- Deployment, security, architecture, development, and troubleshooting guidance

## Phase 6 hardening results

- Connect tokens moved from URL query parameters to the WebSocket Authorization
  header and are stripped before Durable Object forwarding.
- Query-string connect tokens are rejected by regression coverage.
- Status access now requires the root secret, preventing unauthenticated Durable
  Object enumeration/creation pressure.
- Serializable status calls use Durable Object RPC. Proxy and connect retain
  `fetch()` because Cloudflare's supported HTTP streaming and WebSocket upgrade
  handoffs require Request/Response semantics.
- The agent uses its configured HTTP client for both token and WebSocket calls.
- Size, frame, pending-request, timeout, tunnel-ID, internal-header, hop-by-hop
  header, cache, persistence, and logging boundaries were reviewed and documented.

## Verification

The final sweep passed:

```text
pnpm lint
pnpm exec oxlint scripts --deny-warnings
pnpm format --check
pnpm typecheck
pnpm test
pnpm build
cd agents/tunnel && go test ./... && go vet ./...
pnpm test:e2e
```

Results include 71 TypeScript protocol tests, 16 edge tests, all Go package tests,
successful Worker/agent builds, and the E2E flow. E2E verified eight concurrent
requests, 700 KB request and response streams, duplicate Set-Cookie preservation,
cache headers, client cancellation, timeout, Worker restart, token re-minting,
agent reconnect, and a successful request after reconnect.

## Deployment summary

Set the tunnel domain and production limits, upload `AUTH_SECRET` with Wrangler,
configure proxied base/wildcard DNS and Worker routes, and add the mandatory cache
bypass rule. Deploy the Worker, verify `/health`, then run `tunnel login` and
`tunnel http`. Full steps are in [deployment.md](./deployment.md).

## Known limitations

- HTTP only; no TCP, UDP, or SSH.
- Public tunnel URLs have no viewer authentication or rate-limit policy.
- Single administrative root secret; no individual agent revocation or teams.
- One agent per tunnel ID and no hostname reservation service.
- No dashboard, traffic inspection/replay, analytics product, or custom domains.
- The service is designed for single-owner development use, not multi-tenancy or
  production ingress.

## Future improvements

Within a future scope revision, the most useful additions would be optional
viewer authentication, configurable platform rate limits, hidden terminal input
for `tunnel login`, per-agent credentials/revocation, automated deployment checks,
and load/soak tests around slow consumers and maximum configured body sizes.
