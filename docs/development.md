# Development

## Repository layout

- `apps/edge` — Worker, Durable Object, routing, authentication, and edge tests
- `agents/tunnel` — Go CLI, connection manager, and local HTTP proxy
- `packages/protocol` — TypeScript protocol codec and shared fixtures
- `packages/config` — default limits
- `packages/shared` — tunnel ID validation
- `scripts/e2e.mjs` — complete local lifecycle test

## Setup

```sh
pnpm install
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
pnpm build:agent
```

Run the Worker with `pnpm dev:edge`. The development configuration uses
`AUTH_SECRET=development-token`, path routing, and the URL form
`/t/<tunnel-id>/...`. Never reuse the development secret in a deployment.

## Quality checks

Run the root verification commands listed in the README before handing off a
phase. Go-only work can use:

```sh
cd agents/tunnel
go test ./...
go vet ./...
```

Edge tests use the Cloudflare Workers Vitest pool. They need permission to bind a
localhost port. The E2E test uses ports 18787 and 18788 by default and always
attempts to terminate its child processes in `finally` cleanup.

## Protocol changes

Update the TypeScript and Go codecs together. Regenerate or extend
`packages/protocol/fixtures/frames.json`, then run both language suites. Any
wire-incompatible change requires a protocol version bump and an update to
`docs/protocol.md`.

## Coding constraints

- TypeScript is strict and uses Oxlint plus Oxfmt.
- The Go agent intentionally limits dependencies to Cobra and `coder/websocket`
  beyond the standard library.
- Preserve streaming; do not replace request or response streams with whole-body
  buffers.
- Never log authorization values, cookies, query strings, or bodies.
- Never call the Cache API or relax the unconditional response cache headers.
