import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "../env.js";
import { ensureOrganizationForUser } from "./organizations.js";
import { timingSafeSecretEqual } from "./index.js";

export type UserAuth =
  | { readonly ok: true; readonly userId: string; readonly organizationId: string }
  | { readonly ok: false; readonly status: 401 | 503 };

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
  try {
    return { ok: true, userId, organizationId: await ensureOrganizationForUser(env, userId) };
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
