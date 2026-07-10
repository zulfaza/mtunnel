# Security

## Trust model

The root `AUTH_SECRET` is the administrative credential for a ztunnel deployment.
It authorizes short-lived token minting and tunnel-status reads. The agent stores
the server URL and root secret in a mode-0600 configuration file. Agent connect
tokens are HMAC-SHA256 signed, tunnel-bound, purpose-bound, and valid for 15
minutes.

Connect tokens travel in the WebSocket `Authorization` header, not the URL, to
keep them out of ordinary request logs. The Worker removes authorization before
forwarding the upgrade to the Durable Object. Tokens and secrets must never be
written to application logs.

## Public exposure

Tunnel HTTP URLs are intentionally public and have no viewer authentication.
Anyone who knows or discovers a connected tunnel hostname can reach the selected
local server. Do not tunnel admin panels, metadata services, databases, or an
application containing production credentials. Bind the agent only to the
intended host and port and stop it when testing is complete.

Public callers cannot choose an upstream address. The upstream hostname and port
exist only in the local agent process. Tunnel IDs are validated before a Durable
Object lookup. Status requests require the root secret to prevent unauthenticated
Durable Object enumeration or creation pressure.

## Data handling

Bodies stream through memory and are never persisted. Durable Object storage
contains connection timestamps, tunnel ID, agent version, and heartbeat time.
Structured logs contain request IDs, method, status, duration, and byte counts;
they intentionally omit tokens, authorization, cookies, query strings, and
bodies.

Hop-by-hop headers and headers named by `Connection` are stripped. Internal
`x-ztunnel-*` headers supplied by public clients are removed. The Worker supplies
forwarding metadata and overwrites cache headers on every proxied response.

## Resource controls

Defaults are 32 pending requests per tunnel, 50 MiB request bodies, 100 MiB
response bodies, 256 KiB frames, and a 30-second request/response-idle timeout.
Excess work fails explicitly. Review these values before deployment; increasing
them raises per-object memory and abuse exposure.

## Operational recommendations

- Generate at least 32 random bytes for `AUTH_SECRET` and keep it in a password
  manager and Wrangler secret storage.
- Use HTTPS/WSS outside localhost.
- Restrict who can deploy the Worker or read its secret configuration.
- Configure the mandatory cache-bypass rule.
- Monitor authentication failures, 5xx rates, request sizes, and Durable Object
  usage without enabling sensitive request logging.
- Rotate the root secret after suspected disclosure; rotation invalidates every
  agent credential and outstanding token.

## Known limitations

There is no per-tunnel viewer authentication, rate-limit policy, team isolation,
hostname reservation, or revocation list for an individual token. A root-secret
rotation is the revocation mechanism. These are acceptable for the intended
single-owner development use case, not a multi-tenant public service.
