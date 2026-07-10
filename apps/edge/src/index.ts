import { mintAgentToken, timingSafeSecretEqual, verifyAgentToken } from "./auth/index.js";
import { TunnelDO } from "./durable-objects/tunnel-do.js";
import type { Env } from "./env.js";
import { tunnelIdFromDevPath, tunnelIdFromHost } from "./routing/index.js";
import { stripInternalHeaders } from "./utils/headers.js";
import { jsonError, jsonResponse } from "./utils/json.js";
import { isValidTunnelId } from "@tunnel/shared";

function validTokenBody(
  value: unknown,
): { readonly tunnelId: string; readonly sub: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.tunnelId !== "string" || !isValidTunnelId(record.tunnelId)) return null;
  if (record.sub !== undefined && typeof record.sub !== "string") return null;
  return { tunnelId: record.tunnelId, sub: record.sub ?? "agent" };
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  if (!authorizedByRootSecret(request, env.AUTH_SECRET)) return jsonError(401, "unauthorized");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_request");
  }
  const input = validTokenBody(body);
  if (input === null) return jsonError(400, "bad_request");
  const minted = await mintAgentToken(env.AUTH_SECRET, input.tunnelId, input.sub);
  return jsonResponse({
    token: minted.token,
    tunnelId: input.tunnelId,
    expiresAt: minted.claims.exp,
  });
}

function authorizedByRootSecret(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (authorization === null || !authorization.startsWith(prefix)) return false;
  const provided = authorization.slice(prefix.length);
  try {
    return timingSafeSecretEqual(provided, secret);
  } catch {
    return false;
  }
}

function publicOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function doRequest(request: Request, url: URL, headers: Headers): Request {
  const init: RequestInit = { method: request.method, headers, redirect: request.redirect };
  if (request.body !== null) init.body = request.body;
  return new Request(url, init);
}

async function forwardConnect(
  request: Request,
  env: Env,
  tunnelId: string,
  url: URL,
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
  const verified = await verifyAgentToken(token, env.AUTH_SECRET, tunnelId);
  if (!verified.ok) return jsonError(401, "unauthorized", "invalid token");
  const headers = stripInternalHeaders(request.headers);
  headers.delete("authorization");
  headers.set("x-ztunnel-op", "connect");
  headers.set("x-ztunnel-id", tunnelId);
  headers.set("x-ztunnel-public-origin", publicOrigin(url));
  headers.set("x-ztunnel-dev-routing", env.DEV_ROUTING === "true" ? "true" : "false");
  return env.TUNNELS.getByName(tunnelId).fetch(doRequest(request, url, headers));
}

async function forwardProxy(
  request: Request,
  env: Env,
  tunnelId: string,
  url: URL,
): Promise<Response> {
  const headers = stripInternalHeaders(request.headers);
  headers.set("x-ztunnel-id", tunnelId);
  return env.TUNNELS.getByName(tunnelId).fetch(doRequest(request, url, headers));
}

async function fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return jsonResponse({ status: "ok" });
  if (request.method === "POST" && url.pathname === "/api/v1/auth/token")
    return handleToken(request, env);

  const connect = /^\/api\/v1\/tunnels\/([^/]+)\/connect$/u.exec(url.pathname);
  if (request.method === "GET" && connect !== null) {
    const tunnelId = connect[1];
    if (tunnelId === undefined || !isValidTunnelId(tunnelId)) return jsonError(400, "bad_request");
    return forwardConnect(request, env, tunnelId, url);
  }
  const status = /^\/api\/v1\/tunnels\/([^/]+)\/status$/u.exec(url.pathname);
  if (request.method === "GET" && status !== null) {
    if (!authorizedByRootSecret(request, env.AUTH_SECRET)) return jsonError(401, "unauthorized");
    const tunnelId = status[1];
    if (tunnelId === undefined || !isValidTunnelId(tunnelId)) return jsonError(400, "bad_request");
    return jsonResponse(await env.TUNNELS.getByName(tunnelId).status(tunnelId));
  }

  const hostTunnelId = tunnelIdFromHost(request.headers.get("host"), env.TUNNEL_DOMAIN);
  if (hostTunnelId !== null) return forwardProxy(request, env, hostTunnelId, url);
  if (env.DEV_ROUTING === "true") {
    const route = tunnelIdFromDevPath(url.pathname);
    if (route !== null) {
      url.pathname = route.rewrittenPath;
      return forwardProxy(request, env, route.tunnelId, url);
    }
  }
  return jsonError(404, "not_found");
}

export { TunnelDO };
export default { fetch } satisfies ExportedHandler<Env>;
