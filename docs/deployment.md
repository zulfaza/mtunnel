# Deployment

## Prerequisites

Use a Cloudflare Workers Paid account with Durable Objects enabled and a zone you
control. Choose a dedicated tunnel domain such as `tunnel.example.com`.

## Configure

Edit `apps/edge/wrangler.jsonc`:

1. Set `TUNNEL_DOMAIN` to the chosen base domain.
2. Review request, response, pending-request, timeout, and heartbeat limits.
3. Replace the placeholder route comments with routes for the base and wildcard
   hostnames appropriate to your zone.
4. Keep `DEV_ROUTING=false` in production.

Create a high-entropy root secret and upload it without putting it in source:

```sh
cd apps/edge
openssl rand -base64 48
pnpm exec wrangler secret put AUTH_SECRET
```

Store the generated value in a password manager. It authorizes token minting and
status reads and must be shared only with trusted agent users.

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
and subdomains. Keep this rule even though ztunnel also overwrites response
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
./agents/tunnel/bin/tunnel login
./agents/tunnel/bin/tunnel http 3000 --name demo-tunnel
./agents/tunnel/bin/tunnel status demo-tunnel
```

Verify TLS, duplicate Set-Cookie behavior, cache response headers, reconnect after
a Worker deployment, and the offline response after stopping the agent.

## Rollback and secret rotation

Use Wrangler deployment history to roll back Worker code. Rotating `AUTH_SECRET`
immediately invalidates stored agent credentials and all outstanding short-lived
tokens; update the secret, rerun `tunnel login`, and reconnect agents.
