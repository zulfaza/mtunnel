import { limitsForOrganization } from "../../access.js";
import { authenticateUser, authErrorResponse } from "../../auth/workos.js";
import {
  addDomain,
  deleteDomain,
  domainStatus,
  listDomains,
  markDomainUsed,
  verifyDomain,
  type DomainResult,
} from "../../domains.js";
import type { Env } from "../../env.js";
import { jsonError, jsonResponse } from "../../utils/json.js";
import { isValidTunnelId } from "../../utils/tunnel-id.js";

export { markDomainUsed };

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

export async function handleDomainAdd(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
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
      maximumDomains: (await limitsForOrganization(env, auth.organizationId)).maximumCustomDomains,
    }),
  );
}

export async function handleDomainList(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  return jsonResponse(await listDomains(env, auth.organizationId, auth.userId));
}

export async function handleDomainDelete(
  request: Request,
  env: Env,
  hostnameValue: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
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

export async function handleDomainAction(
  request: Request,
  env: Env,
  hostnameValue: string,
  action: "verify" | "status",
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
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

export function domainAction(
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

export function domainHostname(pathname: string): string | null {
  const match = /^\/api\/v1\/domains\/([^/]+)$/u.exec(pathname);
  if (match?.[1] === undefined) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
