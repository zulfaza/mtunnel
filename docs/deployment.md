# Deployment

## Prerequisites

Use a Cloudflare Workers Paid account with Durable Objects and Cloudflare for
SaaS enabled on the `makarima.xyz` zone. Configure an active fallback origin.

## Configure

Edit `apps/api/wrangler.jsonc`:

1. Set `TUNNEL_DOMAIN=makarima.xyz`, `PREVIEW_DOMAIN=preview.makarima.xyz`, `CUSTOM_DOMAIN_CNAME=cname.makarima.xyz`, and replace `WORKOS_CLIENT_ID` with the production application Client ID. The Worker derives the token issuer as `https://api.workos.com/user_management/<WORKOS_CLIENT_ID>`.
2. Review request, response, pending-request, timeout, and heartbeat limits.
3. Review the configured base, API, custom-domain, and wildcard routes for your
   zone before deploying.
4. Keep `DEV_ROUTING=false`, leave `AUTH_MODE` unset, and never configure
   `DEV_AUTH_SECRET` in production.

Create a high-entropy root secret and upload it without putting it in source:

```sh
cd apps/api
openssl rand -base64 48
pnpm exec wrangler secret put AUTH_SECRET
pnpm exec wrangler secret put WORKOS_API_KEY
pnpm exec wrangler secret put CLOUDFLARE_API_TOKEN
pnpm exec wrangler secret put CLOUDFLARE_ZONE_ID
pnpm exec wrangler secret put POSTHOG_API_KEY
```

The Cloudflare API token needs `SSL and Certificates Write` for the tunnel zone.

`POSTHOG_API_KEY` is optional. Use the project token, not a personal API key. When
present, the Worker sends product events to `POSTHOG_HOST`. The configured host
is the EU ingestion endpoint for project 222539. Delivery is asynchronous and
never changes request responses. Site and API funnel events are anonymous;
tunnel activity events use WorkOS user and organization IDs for active-user and
organization reporting. Analytics never includes tunneled URLs, headers, IP
addresses, tokens, config paths, local upstream addresses, or request bodies.
See [Product analytics](analytics.md) for the event schema and privacy boundaries.

Create the D1 database and copy its ID into `wrangler.jsonc`:

```sh
pnpm exec wrangler d1 create mtunnel-domains
```

Create the preview artifact bucket once, before deploy:

```sh
pnpm exec wrangler r2 bucket create mtunnel-previews
```

The Worker cron runs hourly to remove expired previews. `preview.makarima.xyz` is
already covered by the wildcard route, so it needs no extra DNS or certificate setup.

The deployment command applies all pending remote D1 migrations before
deploying the Worker. If a migration fails, the Worker is not deployed.

In the WorkOS production environment:

1. Unlock production and create or select the production application.
2. Enable AuthKit CLI Auth and Google OAuth, including production OAuth
   credentials and consent-screen settings.
3. Copy that application's Client ID to `WORKOS_CLIENT_ID`.
4. Create a production API key and upload it as `WORKOS_API_KEY`. The production
   Client ID and API key must come from the same WorkOS environment.
5. Configure production branding. CLI Auth uses WorkOS's device confirmation
   page and does not require a Worker redirect URI.

For the dashboard application, add these redirect URIs to the same WorkOS
application: `https://app.makarima.xyz/callback`, plus the local development
origins `http://localhost:*/callback` and `http://127.0.0.1:*/callback`.

Configure `apps/dashboard/wrangler.jsonc` with the same D1 and R2 resources and
cross-script `TUNNELS`/`REGISTRY` bindings. Add dashboard secrets:

```sh
cd apps/dashboard
pnpm exec wrangler secret put WORKOS_API_KEY
pnpm exec wrangler secret put CLOUDFLARE_API_TOKEN
pnpm exec wrangler secret put CLOUDFLARE_ZONE_ID
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put AUTH_SECRET
```

Deploy `mtunnel-api` first so the dashboard's Durable Object bindings resolve,
then deploy `mtunnel-dashboard`. The dashboard exchanges WorkOS authorization
codes itself and uses signed HttpOnly `mt_session` cookies; it no longer needs
API CORS or the removed `/api/v1/auth/client` and `/api/v1/auth/code` routes.

Production and staging WorkOS resources are separate; staging configuration is
not copied when production is enabled. `AUTH_SECRET` signs short-lived internal
agent tokens, preview access-code hashes and preview owner tickets; users never
receive it. The dashboard's `AUTH_SECRET` must be byte-identical to the API's,
otherwise the preview host rejects the owner tickets the dashboard mints and
signed-in owners keep seeing the access code gate.

## DNS and routes

Deploy three Workers: `mtunnel-landing` at `makarima.xyz` (and `www`),
`mtunnel-dashboard` at `app.makarima.xyz`, and `mtunnel-api` at
`api.makarima.xyz`. Keep the API wildcard route for tunnel and preview hosts;
Cloudflare selects the explicit application host routes over that wildcard.

Create proxied DNS records for the tunnel base hostname and wildcard hostname,
then configure Worker routes covering both:

```text
tunnel.example.com/*
*.tunnel.example.com/*
```

The exact DNS target can follow the convention used for other routed Workers in
the zone; requests must be orange-cloud proxied. Confirm that an arbitrary valid
hostname such as `probe-test.tunnel.example.com` reaches the Worker and returns a
controlled `502 tunnel_offline` response.

## Mandatory cache bypass

In the Cloudflare dashboard, create a Cache Rule for the entire tunnel hostname
space and set the cache eligibility action to bypass. Match both the base domain
and subdomains. Keep this rule even though mtunnel also overwrites response
headers with `Cache-Control: no-store, no-cache, must-revalidate, private`,
`Pragma: no-cache`, and `Expires: 0`. The dashboard rule is defense in depth
against other cache configuration in the zone.

Do not enable Cache Everything, a Worker Cache API call, or a conflicting cache
rule for the tunnel domain.

## Deploy and verify

```sh
cd apps/api
pnpm run deploy
curl https://api.makarima.xyz/health
```

Expected health response: `{"status":"ok"}`. Then configure the agent:

```sh
./apps/cli/bin/mt login
./apps/cli/bin/mt http 3000 --name demo-tunnel
./apps/cli/bin/mt status demo-tunnel
```

Verify TLS, duplicate Set-Cookie behavior, cache response headers, reconnect after
a Worker deployment, and the offline response after stopping the agent.

For the production auth smoke test, complete `mt login` with a real account,
confirm the CLI reports `Signed in.`, and create a tunnel. A `401 unauthorized`
after browser confirmation usually means `WORKOS_CLIENT_ID` does not match the
production access token. A `503 organization_unavailable` usually means
`WORKOS_API_KEY` is missing, invalid, or from a different WorkOS environment.

## Rollback and secret rotation

Use Wrangler deployment history to roll back Worker code. Rotating `AUTH_SECRET`
immediately invalidates stored agent credentials and all outstanding short-lived
tokens; update the secret, rerun `mt login`, and reconnect agents.
