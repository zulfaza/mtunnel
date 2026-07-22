import { limitsForOrganization } from "../../access.js";
import { verifyAgentToken } from "../../auth/index.js";
import { capture } from "../../analytics.js";
import type { Env } from "../../env.js";
import { stripInternalHeaders } from "../../utils/headers.js";
import { jsonError } from "../../utils/json.js";
import { errorPage } from "../(web)/pages.js";

const OFFLINE_CACHE_MS = 5_000;
const offlineUntil = new Map<string, number>();

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
  headers.set(
    "x-mtunnel-allow-cors",
    request.headers.get("x-mtunnel-allow-cors") === "true" ? "true" : "false",
  );
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

function withCors(response: Response, request: Request): Response {
  const origin = request.headers.get("origin");
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.append("vary", "origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function preflightResponse(request: Request): Response {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  if (origin !== null) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.append("vary", "origin");
  }
  const requestedMethod = request.headers.get("access-control-request-method");
  headers.set("access-control-allow-methods", requestedMethod ?? "GET, POST, PUT, PATCH, DELETE");
  const requestedHeaders = request.headers.get("access-control-request-headers");
  if (requestedHeaders !== null) headers.set("access-control-allow-headers", requestedHeaders);
  headers.set("access-control-max-age", "86400");
  return new Response(null, { status: 204, headers });
}

function stripCorsMarker(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("x-mtunnel-cors");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function forwardProxy(
  request: Request,
  env: Env,
  tunnelId: string,
  url: URL,
  routeType: "standard_domain" | "custom_domain" | "development_path",
): Promise<Response> {
  const isPreflight =
    request.method === "OPTIONS" && request.headers.has("access-control-request-method");
  if (isPreflight && (await env.TUNNELS.getByName(tunnelId).corsEnabled()))
    return preflightResponse(request);
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.PROXY_RATE_LIMITER.limit({ key: `${clientIp}:${tunnelId}` });
  if (!success) return jsonError(429, "rate_limited");
  const offlineKey = `${url.host}:${tunnelId}`;
  const now = Date.now();
  const until = offlineUntil.get(offlineKey);
  if (until !== undefined && until > now) return offlineResponse(request);
  if (until !== undefined) offlineUntil.delete(offlineKey);
  const headers = stripInternalHeaders(request.headers);
  // Force the upstream to respond identity-encoded; the edge compresses for the
  // eyeball. Relaying an already-compressed body makes workerd gzip it a second
  // time, so the browser sees double-encoded garbage.
  headers.delete("accept-encoding");
  headers.set("x-mtunnel-id", tunnelId);
  headers.set("x-mtunnel-route-type", routeType);
  const response = await env.TUNNELS.getByName(tunnelId).fetch(doRequest(request, url, headers));
  const withCorsApplied =
    response.headers.get("x-mtunnel-cors") === "true" ? withCors(response, request) : response;
  if (withCorsApplied.headers.get("x-mtunnel-offline") !== "true")
    return stripCorsMarker(withCorsApplied);
  offlineUntil.set(offlineKey, now + OFFLINE_CACHE_MS);
  return stripCorsMarker(responseWithoutOfflineMarker(withCorsApplied));
}

function offlineResponse(request: Request): Response {
  if (request.headers.get("accept")?.includes("text/html") === true) {
    const response = errorPage(
      502,
      "tunnel_offline",
      "This tunnel is offline. Start the local agent and try again.",
    );
    const headers = new Headers(response.headers);
    headers.set("cache-control", "public, max-age=5");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return new Response(JSON.stringify({ error: "tunnel_offline" }), {
    status: 502,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=5" },
  });
}

function responseWithoutOfflineMarker(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("x-mtunnel-offline");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
