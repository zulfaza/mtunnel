import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env.js";

export type UserAuth = { readonly ok: true; readonly userId: string } | { readonly ok: false };

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") === true && value.length > 7 ? value.slice(7) : null;
}

export async function authenticateUser(request: Request, env: Env): Promise<UserAuth> {
  const token = bearer(request);
  if (token === null) return { ok: false };
  if (env.AUTH_MODE === "development" && env.AUTH_SECRET !== undefined && token === env.AUTH_SECRET)
    return { ok: true, userId: "development-user" };
  try {
    const jwks = createRemoteJWKSet(
      new URL(`https://api.workos.com/sso/jwks/${encodeURIComponent(env.WORKOS_CLIENT_ID)}`),
    );
    const result = await jwtVerify(token, jwks, {
      issuer: env.WORKOS_ISSUER ?? "https://api.workos.com/",
    });
    return result.payload.client_id === env.WORKOS_CLIENT_ID &&
      typeof result.payload.sub === "string"
      ? { ok: true, userId: result.payload.sub }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function workosForm(path: string, body: URLSearchParams): Promise<Response> {
  return fetch(`https://api.workos.com/user_management/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}
