import { mintAgentToken, verifyAgentToken } from "./auth/index.js";
import {
  createQrisCharge,
  createStripeCheckout,
  createStripePortal,
  entitlements,
  handleMidtransWebhook,
  handleStripeWebhook,
} from "./billing.js";
import { authenticateUser, workosForm } from "./auth/workos.js";
import { RegistryDO } from "./durable-objects/registry-do.js";
import { TunnelDO } from "./durable-objects/tunnel-do.js";
import {
  addDomain,
  deleteDomain,
  domainStatus,
  listDomains,
  markDomainUsed,
  tunnelIdForDomain,
  verifyDomain,
  type DomainResult,
} from "./domains.js";
import type { Env } from "./env.js";
import { tunnelIdFromDevPath, tunnelIdFromHost } from "./routing/index.js";
import { stripInternalHeaders } from "./utils/headers.js";
import { jsonError, jsonResponse } from "./utils/json.js";
import { isValidTunnelId } from "@tunnel/shared";
import { errorPage, installScript, landingPage, siteManifest, termsPage } from "./pages.js";

const SITE_ASSET_PATHS = new Set([
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/apple-touch-icon.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/favicon.ico",
  "/favicon.png",
  "/og.png",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTokenBody(
  value: unknown,
): { readonly tunnelId: string; readonly sub: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value.tunnelId !== "string" || !isValidTunnelId(value.tunnelId)) return null;
  if (value.sub !== undefined && typeof value.sub !== "string") return null;
  return { tunnelId: value.tunnelId, sub: value.sub ?? "agent" };
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok)
    return jsonError(
      auth.status,
      auth.status === 401 ? "unauthorized" : "organization_unavailable",
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_request");
  }
  const input = validTokenBody(body);
  if (input === null) return jsonError(400, "bad_request");
  const claimed = await env.REGISTRY.getByName("global").claimTunnel(
    input.tunnelId,
    auth.organizationId,
    auth.userId,
  );
  if (!claimed) return jsonError(409, "tunnel_name_taken");
  if (env.AUTH_SECRET === undefined) return jsonError(500, "server_misconfigured");
  const minted = await mintAgentToken(env.AUTH_SECRET, input.tunnelId, auth.userId);
  return jsonResponse({
    token: minted.token,
    tunnelId: input.tunnelId,
    expiresAt: minted.claims.exp,
  });
}

async function handleBillingCheckout(
  request: Request,
  env: Env,
  provider: "qris" | "stripe",
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok)
    return jsonError(
      auth.status,
      auth.status === 401 ? "unauthorized" : "organization_unavailable",
    );
  try {
    if (provider === "stripe") {
      const url = new URL(request.url);
      return jsonResponse(
        await createStripeCheckout(env, auth.organizationId, `${url.protocol}//${url.host}`),
        201,
      );
    }
    let amount = 10_000;
    const body: unknown = await request.json().catch(() => ({}));
    if (isRecord(body) && body.amountIdr !== undefined) {
      if (typeof body.amountIdr !== "number") return jsonError(400, "bad_request");
      amount = body.amountIdr;
    }
    return jsonResponse(await createQrisCharge(env, auth.organizationId, amount), 201);
  } catch (error) {
    if (error instanceof RangeError) return jsonError(400, "amount_below_minimum", error.message);
    return jsonError(
      503,
      "billing_provider_unavailable",
      error instanceof Error ? error.message : undefined,
    );
  }
}

async function handleBillingPortal(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok)
    return jsonError(
      auth.status,
      auth.status === 401 ? "unauthorized" : "organization_unavailable",
    );
  const url = new URL(request.url);
  try {
    return jsonResponse(
      await createStripePortal(env, auth.organizationId, `${url.protocol}//${url.host}`),
      201,
    );
  } catch (error) {
    if (error instanceof RangeError)
      return jsonError(409, "stripe_customer_missing", error.message);
    return jsonError(
      503,
      "billing_provider_unavailable",
      error instanceof Error ? error.message : undefined,
    );
  }
}

async function handleBillingStatus(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok)
    return jsonError(
      auth.status,
      auth.status === 401 ? "unauthorized" : "organization_unavailable",
    );
  return jsonResponse({
    organizationId: auth.organizationId,
    ...(await entitlements(env, auth.organizationId)),
  });
}

async function proxyWorkosAuth(
  request: Request,
  env: Env,
  kind: "device" | "token" | "refresh",
): Promise<Response> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError(400, "bad_request");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return jsonError(400, "bad_request");
  const body = new URLSearchParams({ client_id: env.WORKOS_CLIENT_ID });
  if (kind === "device") return workosForm("authorize/device", body);
  if (kind === "token" && "deviceCode" in input && typeof input.deviceCode === "string") {
    body.set("device_code", input.deviceCode);
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
  } else if (
    kind === "refresh" &&
    "refreshToken" in input &&
    typeof input.refreshToken === "string" &&
    env.WORKOS_API_KEY !== undefined
  ) {
    return globalThis.fetch("https://api.workos.com/user_management/authenticate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: env.WORKOS_CLIENT_ID,
        client_secret: env.WORKOS_API_KEY,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
      }),
    });
  } else return jsonError(400, "bad_request");
  return workosForm("authenticate", body);
}

function validHostname(value: string): boolean {
  return (
    value.length <= 253 &&
    value.split(".").length >= 2 &&
    value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  );
}

function domainResponse(result: DomainResult): Response {
  if (result.ok) return jsonResponse(result.domain, result.created === true ? 201 : 200);
  const body = {
    error: result.error,
    ...(result.message === undefined ? {} : { message: result.message }),
    ...(result.domain === undefined ? {} : { domain: result.domain }),
  };
  return jsonResponse(body, result.status);
}

async function handleDomainAdd(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok)
    return jsonError(
      auth.status,
      auth.status === 401 ? "unauthorized" : "organization_unavailable",
    );
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return jsonError(400, "bad_request");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return jsonError(400, "bad_request");
  if (
    !("hostname" in value) ||
    !("tunnelId" in value) ||
    typeof value.hostname !== "string" ||
    typeof value.tunnelId !== "string"
  )
    return jsonError(400, "bad_request");
  const hostname = value.hostname.trim().toLowerCase();
  if (
    !validHostname(hostname) ||
    hostname === env.TUNNEL_DOMAIN ||
    hostname.endsWith(`.${env.TUNNEL_DOMAIN}`) ||
    !isValidTunnelId(value.tunnelId)
  )
    return jsonError(400, "bad_request");
  return domainResponse(
    await addDomain(env, {
      hostname,
      tunnelId: value.tunnelId,
      organizationId: auth.organizationId,
      userId: auth.userId,
    }),
  );
}

async function handleDomainList(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok)
    return jsonError(
      auth.status,
      auth.status === 401 ? "unauthorized" : "organization_unavailable",
    );
  return jsonResponse(await listDomains(env, auth.organizationId, auth.userId));
}

async function handleDomainDelete(
  request: Request,
  env: Env,
  hostnameValue: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok)
    return jsonError(
      auth.status,
      auth.status === 401 ? "unauthorized" : "organization_unavailable",
    );
  const hostname = hostnameValue.trim().toLowerCase();
  if (
    !validHostname(hostname) ||
    hostname === env.TUNNEL_DOMAIN ||
    hostname.endsWith(`.${env.TUNNEL_DOMAIN}`)
  )
    return jsonError(400, "bad_request");
  const result = await deleteDomain(env, hostname, auth.organizationId, auth.userId);
  return result === null ? jsonError(404, "not_found") : domainResponse(result);
}

async function handleDomainAction(
  request: Request,
  env: Env,
  hostnameValue: string,
  action: "verify" | "status",
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok)
    return jsonError(
      auth.status,
      auth.status === 401 ? "unauthorized" : "organization_unavailable",
    );
  const hostname = hostnameValue.trim().toLowerCase();
  if (
    !validHostname(hostname) ||
    hostname === env.TUNNEL_DOMAIN ||
    hostname.endsWith(`.${env.TUNNEL_DOMAIN}`)
  )
    return jsonError(400, "bad_request");
  return domainResponse(
    action === "verify"
      ? await verifyDomain(env, hostname, auth.organizationId, auth.userId)
      : await domainStatus(env, hostname, auth.organizationId, auth.userId),
  );
}

function domainAction(
  pathname: string,
): { readonly hostname: string; readonly action: "verify" | "status" } | null {
  const match = /^\/api\/v1\/domains\/([^/]+)\/(verify|status)$/u.exec(pathname);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  let hostname: string;
  try {
    hostname = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return match[2] === "verify" || match[2] === "status" ? { hostname, action: match[2] } : null;
}

function domainHostname(pathname: string): string | null {
  const match = /^\/api\/v1\/domains\/([^/]+)$/u.exec(pathname);
  if (match?.[1] === undefined) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
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
  if (env.AUTH_SECRET === undefined) return jsonError(500, "server_misconfigured");
  const verified = await verifyAgentToken(token, env.AUTH_SECRET, tunnelId);
  if (!verified.ok) return jsonError(401, "unauthorized", "invalid token");
  const registry = env.REGISTRY.getByName("global");
  const organizationId = await registry.organizationForTunnel(tunnelId);
  if (organizationId === null) return jsonError(404, "not_found");
  const limits = await entitlements(env, organizationId);
  const connectionId = crypto.randomUUID();
  if (
    !(await registry.acquireConnection(tunnelId, organizationId, connectionId, limits.tunnelLimit))
  )
    return jsonError(429, "tunnel_limit_reached");
  const headers = stripInternalHeaders(request.headers);
  headers.delete("authorization");
  headers.set("x-mtunnel-op", "connect");
  headers.set("x-mtunnel-id", tunnelId);
  headers.set("x-mtunnel-public-origin", publicOrigin(url));
  headers.set("x-mtunnel-dev-routing", env.DEV_ROUTING === "true" ? "true" : "false");
  headers.set("x-mtunnel-organization-id", organizationId);
  headers.set("x-mtunnel-connection-id", connectionId);
  headers.set(
    "x-mtunnel-lifetime-seconds",
    limits.tunnelLifetimeSeconds === null ? "0" : String(limits.tunnelLifetimeSeconds),
  );
  let response: Response;
  try {
    response = await env.TUNNELS.getByName(tunnelId).fetch(doRequest(request, url, headers));
  } catch (error) {
    await registry.releaseConnection(tunnelId, organizationId, connectionId);
    throw error;
  }
  if (response.status !== 101)
    await registry.releaseConnection(tunnelId, organizationId, connectionId);
  return response;
}

async function forwardProxy(
  request: Request,
  env: Env,
  tunnelId: string,
  url: URL,
): Promise<Response> {
  const headers = stripInternalHeaders(request.headers);
  // Force the upstream to respond identity-encoded; the edge compresses for the
  // eyeball. Relaying an already-compressed body makes workerd gzip it a second
  // time, so the browser sees double-encoded garbage.
  headers.delete("accept-encoding");
  headers.set("x-mtunnel-id", tunnelId);
  return env.TUNNELS.getByName(tunnelId).fetch(doRequest(request, url, headers));
}

async function fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const isPrimaryHost = hostname === env.TUNNEL_DOMAIN.toLowerCase();
  if (request.method === "GET" && isPrimaryHost && SITE_ASSET_PATHS.has(url.pathname))
    return env.ASSETS.fetch(request);
  if (request.method === "GET" && url.pathname === "/" && isPrimaryHost) return landingPage();
  if (request.method === "GET" && url.pathname === "/terms" && isPrimaryHost) return termsPage();
  if (request.method === "GET" && url.pathname === "/site.webmanifest" && isPrimaryHost)
    return siteManifest();
  if (request.method === "GET" && url.pathname === "/install.sh" && isPrimaryHost)
    return installScript();
  if (request.method === "GET" && url.pathname === "/health") return jsonResponse({ status: "ok" });
  if (request.method === "POST" && url.pathname === "/api/v1/auth/device")
    return proxyWorkosAuth(request, env, "device");
  if (request.method === "POST" && url.pathname === "/api/v1/auth/device/token")
    return proxyWorkosAuth(request, env, "token");
  if (request.method === "POST" && url.pathname === "/api/v1/auth/refresh")
    return proxyWorkosAuth(request, env, "refresh");
  if (request.method === "POST" && url.pathname === "/api/v1/auth/token")
    return handleToken(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/billing/qris")
    return handleBillingCheckout(request, env, "qris");
  if (request.method === "POST" && url.pathname === "/api/v1/billing/stripe")
    return handleBillingCheckout(request, env, "stripe");
  if (request.method === "POST" && url.pathname === "/api/v1/billing/portal")
    return handleBillingPortal(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/billing/status")
    return handleBillingStatus(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/webhooks/midtrans")
    return (await handleMidtransWebhook(request, env))
      ? jsonResponse({ received: true })
      : jsonError(400, "invalid_webhook");
  if (request.method === "POST" && url.pathname === "/api/v1/webhooks/stripe")
    return (await handleStripeWebhook(request, env))
      ? jsonResponse({ received: true })
      : jsonError(400, "invalid_webhook");
  if (request.method === "POST" && url.pathname === "/api/v1/domains")
    return handleDomainAdd(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/domains")
    return handleDomainList(request, env);
  const requestedDomainHostname = domainHostname(url.pathname);
  if (request.method === "DELETE" && requestedDomainHostname !== null)
    return handleDomainDelete(request, env, requestedDomainHostname);
  const requestedDomainAction = domainAction(url.pathname);
  if (
    requestedDomainAction !== null &&
    ((request.method === "POST" && requestedDomainAction.action === "verify") ||
      (request.method === "GET" && requestedDomainAction.action === "status"))
  )
    return handleDomainAction(
      request,
      env,
      requestedDomainAction.hostname,
      requestedDomainAction.action,
    );

  const connect = /^\/api\/v1\/tunnels\/([^/]+)\/connect$/u.exec(url.pathname);
  if (request.method === "GET" && connect !== null) {
    const tunnelId = connect[1];
    if (tunnelId === undefined || !isValidTunnelId(tunnelId)) return jsonError(400, "bad_request");
    return forwardConnect(request, env, tunnelId, url);
  }
  const status = /^\/api\/v1\/tunnels\/([^/]+)\/status$/u.exec(url.pathname);
  if (request.method === "GET" && status !== null) {
    const auth = await authenticateUser(request, env);
    if (!auth.ok)
      return jsonError(
        auth.status,
        auth.status === 401 ? "unauthorized" : "organization_unavailable",
      );
    const tunnelId = status[1];
    if (tunnelId === undefined || !isValidTunnelId(tunnelId)) return jsonError(400, "bad_request");
    if (
      !(await env.REGISTRY.getByName("global").ownsTunnel(
        tunnelId,
        auth.organizationId,
        auth.userId,
      ))
    )
      return jsonError(404, "not_found");
    return jsonResponse(await env.TUNNELS.getByName(tunnelId).status(tunnelId));
  }

  const hostTunnelId = tunnelIdFromHost(request.headers.get("host"), env.TUNNEL_DOMAIN);
  if (hostTunnelId !== null) return forwardProxy(request, env, hostTunnelId, url);
  const customTunnelId = await tunnelIdForDomain(env, hostname);
  if (customTunnelId !== null) {
    ctx.waitUntil(markDomainUsed(env, hostname));
    return forwardProxy(request, env, customTunnelId, url);
  }
  if (env.DEV_ROUTING === "true") {
    const route = tunnelIdFromDevPath(url.pathname);
    if (route !== null) {
      url.pathname = route.rewrittenPath;
      return forwardProxy(request, env, route.tunnelId, url);
    }
  }
  return errorPage(404, "not_found", "This page does not exist, or the tunnel address is invalid.");
}

export { RegistryDO, TunnelDO };
export default { fetch } satisfies ExportedHandler<Env>;
