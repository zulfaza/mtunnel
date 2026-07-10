# ztunnel

ztunnel is a small, self-hosted development tunnel for exposing a local HTTP
server through Cloudflare. A Worker routes public traffic to one Durable Object
per tunnel; a Go agent maintains a hibernatable WebSocket connection and streams
requests to localhost.

It is intended for personal development and webhook testing. It is not a general
TCP tunnel, traffic inspector, multi-user service, or production ingress.

## Requirements

- Node.js 24 or newer
- pnpm 10.12.3
- Go 1.25 or newer
- A Cloudflare Workers Paid account and a zone for the tunnel domain

## Install

```sh
curl -fsSL https://makarima.xyz/install.sh | sh
ztunnel login
ztunnel http 3000 --name demo-tunnel
```

Login uses WorkOS AuthKit device authorization (including Google). Update with
`ztunnel update`. Add a custom hostname with:

```sh
ztunnel domain add dev-dash.upsell.is --name demo-tunnel
```

Then create the printed CNAME record to `makarima.xyz`.

## Local quick start

Install dependencies and build the agent:

```sh
pnpm install
pnpm build:agent
```

Create `apps/edge/.dev.vars` from the example, then start the Worker:

```sh
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
pnpm dev:edge
```

In another terminal, start a local application and the tunnel agent:

```sh
./agents/tunnel/bin/ztunnel http 3000 \
  --server http://127.0.0.1:8787 \
  --token development-token \
  --name local-test
```

Expected banner:

```text
Tunnel connected

Public URL:
http://127.0.0.1:8787/t/local-test

Forwarding:
http://127.0.0.1:3000
```

Open `http://127.0.0.1:8787/t/local-test/`. Local development path routing is
enabled only when `DEV_ROUTING=true`.

## CLI

Persist WorkOS credentials in a mode-0600 config file:

```sh
./agents/tunnel/bin/ztunnel login
```

Then open or inspect a named tunnel:

```sh
./agents/tunnel/bin/ztunnel http 3000 --name demo-tunnel
./agents/tunnel/bin/ztunnel status demo-tunnel
./agents/tunnel/bin/ztunnel version
```

Common flags are `--server`, `--token`, `--config`, `--hostname`, `--name`,
`--request-timeout`, and `--log-level`. Command-line secrets can be visible in
the local process list; prefer `ztunnel login` for routine use.

Only one agent may own a tunnel name. A newer connection replaces the older one.
The agent automatically re-mints a short-lived token and reconnects with
exponential backoff after an unexpected disconnect.

## Testing

```sh
pnpm lint
pnpm format --check
pnpm typecheck
pnpm test
pnpm build
pnpm build:agent
pnpm test:agent
pnpm test:e2e
```

The E2E test starts Wrangler, a fixture HTTP server, and the compiled agent on
localhost. Override its ports with `ZTUNNEL_E2E_EDGE_PORT` and
`ZTUNNEL_E2E_UPSTREAM_PORT`.

## Documentation

- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Deployment](docs/deployment.md)
- [Security](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Wire protocol](docs/protocol.md)
- [Implementation plan and status](docs/plan.md)

## Scope and limitations

ztunnel supports streamed HTTP only. TCP, UDP, SSH, custom domains, dashboards,
teams, analytics, replay, inspection, multiple agents per tunnel, and response
caching are intentionally out of scope. Public tunnel URLs have no end-user
authentication; anything reachable through the selected local port is public
while the tunnel is connected.
