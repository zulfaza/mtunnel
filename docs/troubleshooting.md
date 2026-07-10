# Troubleshooting

## Agent cannot mint a token

- Confirm the server URL includes `http://` or `https://`.
- Confirm `AUTH_SECRET` matches the Worker secret. Development defaults belong in
  `apps/edge/.dev.vars`, not the shell environment alone.
- Check `/health` independently.
- A `401` means the root secret is missing or wrong; a network error usually means
  the Worker URL, DNS, TLS, or local Wrangler process is unavailable.

## Tunnel reports offline

Run `mt status <name>` using the same saved credentials. Confirm the agent's
banner uses the expected tunnel ID. Only one agent can own a name; a newer agent
closes the old connection with code 4001.

If logs show repeated reconnects, inspect TLS/DNS, Worker errors, and whether Ping
and Pong frames pass through any intermediary. Normal reconnect backoff grows
from roughly 500 ms to 30 seconds.

## Public URL returns 404

In local development, set `DEV_ROUTING=true` and use
`/t/<tunnel-id>/<path>`. In production, use `<tunnel-id>.<TUNNEL_DOMAIN>` and
verify both wildcard DNS and Worker routes. Tunnel IDs must be 3–63 lowercase
letters, digits, or hyphens, beginning and ending with a letter or digit.

## 502, 503, or 504 responses

- `502 tunnel_offline` — no agent completed the handshake.
- Other `502` responses — WebSocket/protocol failure or the local upstream failed.
- `503 too_many_requests` — the tunnel reached its pending-request limit.
- `504 timeout` — no response began, or a streamed response was idle beyond the
  configured timeout.

Check that the local application listens on the hostname supplied by
`--hostname` (default `127.0.0.1`) and the requested port.

## Large upload or download fails

Compare the payload with `MAX_REQUEST_BYTES` and `MAX_RESPONSE_BYTES` in
`wrangler.jsonc`. Frame chunking is automatic; changing the 256 KiB protocol
frame limit independently is not supported. Also inspect upstream application and
Cloudflare platform limits.

## Responses appear cached

Every tunnel response should include the three no-cache headers documented in
[deployment.md](./deployment.md). If not, confirm traffic reaches this Worker. If
the headers are present but content is cached, inspect zone Cache Rules and add or
fix the mandatory bypass rule for the entire tunnel domain.

## Local tests fail to bind a port

The Worker pool and E2E suite require localhost sockets. Stop stale Wrangler or
agent processes, or override `MTUNNEL_E2E_EDGE_PORT` and
`MTUNNEL_E2E_UPSTREAM_PORT`. Restricted sandboxes may need explicit loopback
permission.
