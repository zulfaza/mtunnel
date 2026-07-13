import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "../env.js";
import { ensureOrganizationForUser, organizationForMember } from "./organizations.js";
import { timingSafeSecretEqual } from "./index.js";
import { jsonError } from "../utils/json.js";

export type UserAuth =
  | { readonly ok: true; readonly userId: string; readonly organizationId: string }
  | { readonly ok: false; readonly status: 401 | 403 | 503 };

export function authErrorResponse(auth: { readonly status: 401 | 403 | 503 }): Response {
  const error =
    auth.status === 401
      ? "unauthorized"
      : auth.status === 403
        ? "forbidden"
        : "organization_unavailable";
  return jsonError(auth.status, error);
}

const jwksByClientId = new Map<string, JWTVerifyGetKey>();

function jwksForClient(clientId: string): JWTVerifyGetKey {
  const existing = jwksByClientId.get(clientId);
  if (existing !== undefined) return existing;
  const jwks = createRemoteJWKSet(
    new URL(`https://api.workos.com/sso/jwks/${encodeURIComponent(clientId)}`),
  );
  jwksByClientId.set(clientId, jwks);
  return jwks;
}

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  return /^Bearer [^\s]+$/iu.test(value ?? "") ? (value?.slice(7) ?? null) : null;
}

export async function verifyWorkosAccessToken(
  token: string,
  env: Pick<Env, "WORKOS_CLIENT_ID">,
  jwks: JWTVerifyGetKey = jwksForClient(env.WORKOS_CLIENT_ID),
): Promise<string | null> {
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}`,
    });
    if (result.payload.client_id !== env.WORKOS_CLIENT_ID || typeof result.payload.sub !== "string")
      return null;
    return result.payload.sub;
  } catch {
    return null;
  }
}

export async function authenticateUser(request: Request, env: Env): Promise<UserAuth> {
  const token = bearer(request);
  if (token === null) return { ok: false, status: 401 };
  if (
    env.AUTH_MODE === "development" &&
    env.DEV_AUTH_SECRET !== undefined &&
    timingSafeSecretEqual(token, env.DEV_AUTH_SECRET)
  )
    return {
      ok: true,
      userId: "development-user",
      organizationId: "development-organization",
    };
  const userId = await verifyWorkosAccessToken(token, env);
  if (userId === null) return { ok: false, status: 401 };
  const requestedOrganizationId = request.headers.get("x-organization-id");
  try {
    const organizationId =
      requestedOrganizationId === null
        ? await ensureOrganizationForUser(env, userId)
        : await organizationForMember(env, userId, requestedOrganizationId);
    if (organizationId === null) return { ok: false, status: 403 };
    return { ok: true, userId, organizationId };
  } catch {
    return { ok: false, status: 503 };
  }
}

export async function workosForm(path: string, body: URLSearchParams): Promise<Response> {
  return fetch(`https://api.workos.com/user_management/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}
