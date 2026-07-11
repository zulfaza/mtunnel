# Deployment

## Prerequisites

Use a Cloudflare Workers Paid account with Durable Objects and Cloudflare for
SaaS enabled on the `makarima.xyz` zone. Configure an active fallback origin.

## Configure

Edit `apps/edge/wrangler.jsonc`:

1. Set `TUNNEL_DOMAIN=makarima.xyz` and replace `WORKOS_CLIENT_ID`.
2. Review request, response, pending-request, timeout, and heartbeat limits.
3. Replace the placeholder route comments with routes for the base and wildcard
   hostnames appropriate to your zone.
4. Keep `DEV_ROUTING=false` in production.

Create a high-entropy root secret and upload it without putting it in source:

```sh
cd apps/edge
openssl rand -base64 48
pnpm exec wrangler secret put AUTH_SECRET
pnpm exec wrangler secret put WORKOS_API_KEY
pnpm exec wrangler secret put CLOUDFLARE_API_TOKEN
pnpm exec wrangler secret put CLOUDFLARE_ZONE_ID
pnpm exec wrangler secret put MIDTRANS_SERVER_KEY
pnpm exec wrangler secret put STRIPE_SECRET_KEY
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET
```

The Cloudflare API token needs `SSL and Certificates Write` for the tunnel zone.

Create the D1 database, copy its ID into `wrangler.jsonc`, and apply migrations:

```sh
pnpm exec wrangler d1 create mtunnel-domains
pnpm exec wrangler d1 migrations apply mtunnel-domains --remote
```

Enable AuthKit CLI Auth and Google OAuth in WorkOS. `AUTH_SECRET` signs only
short-lived internal agent tokens; users never receive it.

Billing is organization-scoped. Configure these provider callbacks after deploy:

- Midtrans payment notification: `https://<TUNNEL_DOMAIN>/api/v1/webhooks/midtrans`
- Stripe webhook: `https://<TUNNEL_DOMAIN>/api/v1/webhooks/stripe`, subscribed to
  `customer.subscription.created`, `customer.subscription.updated`, and
  `customer.subscription.deleted`

Set `MIDTRANS_IS_PRODUCTION=true` under `vars` only when using the production
Midtrans server key; when omitted, QRIS charges use the sandbox. Stripe Checkout
creates the Rp50,000 monthly card price inline, so no Stripe product or price ID
is required. Enable Stripe's customer portal so organizations can manage or
cancel recurring payments. Run `mt billing status`, `mt billing qris`,
`mt billing subscribe`, `mt billing portal`, or `mt billing sync` to exercise
the authenticated organization flows. Checkout creates and persists the Stripe
customer before opening the payment page. Webhooks use the event only to locate
that customer, then fetch and store authoritative subscription state from Stripe.

## DNS and routes

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
cd apps/edge
pnpm exec wrangler deploy
curl https://tunnel.example.com/health
```

Expected health response: `{"status":"ok"}`. Then configure the agent:

```sh
./agents/tunnel/bin/mt login
./agents/tunnel/bin/mt http 3000 --name demo-tunnel
./agents/tunnel/bin/mt status demo-tunnel
```

Verify TLS, duplicate Set-Cookie behavior, cache response headers, reconnect after
a Worker deployment, and the offline response after stopping the agent.

## Rollback and secret rotation

Use Wrangler deployment history to roll back Worker code. Rotating `AUTH_SECRET`
immediately invalidates stored agent credentials and all outstanding short-lived
tokens; update the secret, rerun `mt login`, and reconnect agents.
