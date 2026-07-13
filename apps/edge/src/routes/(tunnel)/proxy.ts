import { limitsForOrganization } from "../../access.js";
import { verifyAgentToken } from "../../auth/index.js";
import { capture } from "../../analytics.js";
import type { Env } from "../../env.js";
import { stripInternalHeaders } from "../../utils/headers.js";
import { jsonError } from "../../utils/json.js";

function publicOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function doRequest(request: Request, url: URL, headers: Headers): Request {
  const init: RequestInit = { method: request.method, headers, redirect: request.redirect };
  if (request.body !== null) init.body = request.body;
  return new Request(url, init);
}

export async function forwardConnect(
  request: Request,
  env: Env,
  tunnelId: string,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(426, "upgrade_required");
  }
  const authorization = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (authorization === null || !authorization.startsWith(prefix))
    return jsonError(401, "unauthorized");
  const token = authorization.slice(prefix.length);
  if (token === "") return jsonError(401, "unauthorized");
  if (env.AUTH_SECRET === undefined) return jsonError(500, "server_misconfigured");
  const verified = await verifyAgentToken(token, env.AUTH_SECRET, tunnelId);
  if (!verified.ok) return jsonError(401, "unauthorized", "invalid token");
  const registry = env.REGISTRY.getByName("global");
  const organizationId = await registry.organizationForTunnel(tunnelId);
  if (organizationId === null) return jsonError(404, "not_found");
  const limits = await limitsForOrganization(env, organizationId);
  const connectionId = crypto.randomUUID();
  if (
    !(await registry.acquireConnection(
      tunnelId,
      organizationId,
      connectionId,
      limits.maximumActiveTunnels,
    ))
  )
    return jsonError(429, "active_tunnel_limit_reached");
  const headers = stripInternalHeaders(request.headers);
  headers.delete("authorization");
  headers.set("x-mtunnel-op", "connect");
  headers.set("x-mtunnel-id", tunnelId);
  headers.set("x-mtunnel-public-origin", publicOrigin(url));
  headers.set("x-mtunnel-dev-routing", env.DEV_ROUTING === "true" ? "true" : "false");
  headers.set("x-mtunnel-organization-id", organizationId);
  headers.set("x-mtunnel-user-id", verified.claims.sub);
  headers.set("x-mtunnel-connection-id", connectionId);
  headers.set("x-mtunnel-lifetime-seconds", String(limits.maximumTunnelLifetimeSeconds));
  headers.set("x-mtunnel-idle-seconds", String(limits.idleTimeoutSeconds));
  let response: Response;
  try {
    response = await env.TUNNELS.getByName(tunnelId).fetch(doRequest(request, url, headers));
  } catch (error) {
    await registry.releaseConnection(tunnelId, organizationId, connectionId);
    throw error;
  }
  if (response.status !== 101)
    await registry.releaseConnection(tunnelId, organizationId, connectionId);
  else {
    const cf = request.cf;
    ctx.waitUntil(
      capture(env, {
        event: "tunnel connected",
        distinctId: verified.claims.sub,
        organizationId,
        properties: {
          $session_id: connectionId,
          tunnel_id: tunnelId,
          usage_source: request.headers.get("x-mtunnel-usage-source") ?? "terminal",
          operating_system: request.headers.get("x-mtunnel-operating-system") ?? "unknown",
          agent_version: request.headers.get("x-mtunnel-agent-version") ?? "unknown",
          country: typeof cf?.country === "string" ? cf.country : undefined,
          region: typeof cf?.region === "string" ? cf.region : undefined,
          city: typeof cf?.city === "string" ? cf.city : undefined,
          timezone: typeof cf?.timezone === "string" ? cf.timezone : undefined,
          cloudflare_colo: typeof cf?.colo === "string" ? cf.colo : undefined,
        },
      }),
    );
  }
  return response;
}

export async function forwardProxy(
  request: Request,
  env: Env,
  tunnelId: string,
  url: URL,
  routeType: "standard_domain" | "custom_domain" | "development_path",
): Promise<Response> {
  const headers = stripInternalHeaders(request.headers);
  // Force the upstream to respond identity-encoded; the edge compresses for the
  // eyeball. Relaying an already-compressed body makes workerd gzip it a second
  // time, so the browser sees double-encoded garbage.
  headers.delete("accept-encoding");
  headers.set("x-mtunnel-id", tunnelId);
  headers.set("x-mtunnel-route-type", routeType);
  return env.TUNNELS.getByName(tunnelId).fetch(doRequest(request, url, headers));
}
