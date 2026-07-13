import type { Env } from "../../env.js";
import { jsonError } from "../../utils/json.js";
import { isValidTunnelId } from "../../utils/tunnel-id.js";
import type { TrackedEvent } from "../tracked-event.js";
import { forwardConnect } from "../(tunnel)/proxy.js";
import { handleToken, proxyWorkosAuth } from "./auth.js";
import {
  domainAction,
  domainHostname,
  handleDomainAction,
  handleDomainAdd,
  handleDomainDelete,
  handleDomainList,
} from "./domains.js";
import { handleOrganizationCreate, handleOrganizationList } from "./organizations.js";
import { handleTunnelStatus } from "./tunnels.js";

export async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  if (request.method === "POST" && url.pathname === "/api/v1/auth/device")
    return proxyWorkosAuth(request, env, "device");
  if (request.method === "POST" && url.pathname === "/api/v1/auth/device/token")
    return proxyWorkosAuth(request, env, "token");
  if (request.method === "POST" && url.pathname === "/api/v1/auth/refresh")
    return proxyWorkosAuth(request, env, "refresh");
  if (request.method === "POST" && url.pathname === "/api/v1/auth/token")
    return handleToken(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/domains")
    return handleDomainAdd(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/domains")
    return handleDomainList(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/organizations")
    return handleOrganizationList(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/organizations")
    return handleOrganizationCreate(request, env);
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
    return forwardConnect(request, env, tunnelId, url, ctx);
  }
  const status = /^\/api\/v1\/tunnels\/([^/]+)\/status$/u.exec(url.pathname);
  if (request.method === "GET" && status !== null) {
    const tunnelId = status[1];
    if (tunnelId === undefined) return jsonError(400, "bad_request");
    return handleTunnelStatus(request, env, tunnelId);
  }
  return jsonError(404, "not_found");
}

export function trackedApiEvent(request: Request, url: URL): TrackedEvent | null {
  if (request.method === "POST" && url.pathname === "/api/v1/auth/device")
    return { event: "device_authorization_started" };
  if (request.method === "POST" && url.pathname === "/api/v1/auth/token")
    return { event: "tunnel_claim_requested" };
  if (request.method === "POST" && url.pathname === "/api/v1/domains")
    return { event: "custom_domain_add_requested" };
  if (request.method === "POST" && url.pathname === "/api/v1/organizations")
    return { event: "organization_create_requested" };
  if (request.method === "DELETE" && domainHostname(url.pathname) !== null)
    return { event: "custom_domain_delete_requested" };
  const domainRequest = domainAction(url.pathname);
  if (
    domainRequest !== null &&
    ((request.method === "POST" && domainRequest.action === "verify") ||
      (request.method === "GET" && domainRequest.action === "status"))
  )
    return {
      event: "custom_domain_action_requested",
      properties: { action: domainRequest.action },
    };
  if (request.method === "GET" && /^\/api\/v1\/tunnels\/[^/]+\/connect$/u.test(url.pathname))
    return { event: "tunnel_connection_requested" };
  return null;
}
