import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env.js";
import { ensureOrganizationForUser } from "./organizations.js";
import { timingSafeSecretEqual } from "./index.js";

export type UserAuth =
  | { readonly ok: true; readonly userId: string; readonly organizationId: string }
  | { readonly ok: false; readonly status: 401 | 503 };

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") === true && value.length > 7 ? value.slice(7) : null;
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
  let userId: string;
  try {
    const jwks = createRemoteJWKSet(
      new URL(`https://api.workos.com/sso/jwks/${encodeURIComponent(env.WORKOS_CLIENT_ID)}`),
    );
    const result = await jwtVerify(token, jwks, {
      issuer: env.WORKOS_ISSUER ?? "https://api.workos.com/",
    });
    if (
      result.payload.client_id !== env.WORKOS_CLIENT_ID ||
      typeof result.payload.sub !== "string"
    )
      return { ok: false, status: 401 };
    userId = result.payload.sub;
  } catch {
    return { ok: false, status: 401 };
  }
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
