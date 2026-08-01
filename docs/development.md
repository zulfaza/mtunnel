# Development

## Repository layout

- `apps/api` — Worker, Durable Objects, routing, authentication, and API tests
- `apps/cli` — Go CLI, connection manager, and local HTTP proxy
- `apps/dashboard` — TanStack Start dashboard Worker
- `apps/landing` — SvelteKit marketing site Worker
- `packages/protocol` — TypeScript protocol codec and shared fixtures
- `packages/config` — default limits
- `packages/assets` — shared brand assets
- `scripts/e2e.mjs` — complete local lifecycle test

## Setup

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm build:cli
```

Run the API Worker with `pnpm dev:api`. The development configuration uses
`DEV_AUTH_SECRET=development-token` (a login backdoor, distinct from the
`AUTH_SECRET` that signs agent tokens), path routing, and the URL form
`/t/<tunnel-id>/...`. Never reuse the development secret in a deployment.

## Quality checks

Run the root verification commands listed in the README before handing off a
phase. Go-only work can use:

```sh
cd apps/cli
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

## Dashboard development

The dashboard is a TanStack Start Worker. Configure bindings in
`apps/dashboard/wrangler.jsonc`; cross-script Durable Object bindings need
`mtunnel-api` deployed in the same Cloudflare account. For local auth, set
`WORKOS_API_KEY` and a random `SESSION_SECRET` (at least 32 bytes) in the
dashboard `.dev.vars`. Run the API as the auxiliary Worker when testing D1,
R2, or Durable Object behavior; do not point dashboard code at API HTTP routes.

Dashboard server-only code lives under `apps/dashboard/src/server` and calls
`@tunnel/core` through its cached runtime. Client components use TanStack Start
server functions for reads and mutations. Keep session cookies HttpOnly and do
not move WorkOS exchange or Cloudflare secrets into client code.

## Effect conventions

Follow the conventions recorded in the migration plan: v4 `Context.Service`,
module-scope Schema decoders, `Effect.fn` for argument-bearing effects, tagged
errors at boundaries, and streaming bodies passed through without buffering.
