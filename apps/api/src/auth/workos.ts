import { Errors, Workos } from "@tunnel/core";
import type { JWTVerifyGetKey } from "jose";
import {
  authenticateUser as authenticateCoreUser,
  workosForm as workosCoreForm,
} from "../runtime.js";
import type { Env } from "../env.js";
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

export async function verifyWorkosAccessTokenForEnv(
  token: string,
  env: Pick<Env, "WORKOS_CLIENT_ID">,
): Promise<string | null> {
  return Workos.verifyWorkosAccessToken(token, env.WORKOS_CLIENT_ID);
}

export function verifyWorkosAccessToken(
  token: string,
  env: Pick<Env, "WORKOS_CLIENT_ID">,
  jwks?: JWTVerifyGetKey,
): Promise<string | null> {
  return Workos.verifyWorkosAccessToken(token, env.WORKOS_CLIENT_ID, jwks);
}

export async function authenticateUser(request: Request, env: Env): Promise<UserAuth> {
  return authenticateCoreUser(request, env);
}

export async function workosForm(
  path: string,
  body: URLSearchParams,
  env?: Env,
): Promise<Response> {
  if (env === undefined)
    return fetch(`https://api.workos.com/user_management/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  return workosCoreForm(path, body, env);
}

export function coreAuthenticationError(error: unknown): Response | null {
  if (error instanceof Errors.UnauthorizedError) return jsonError(401, "unauthorized");
  if (error instanceof Errors.ForbiddenError) return jsonError(403, "forbidden");
  return error instanceof Errors.OrganizationUnavailableError
    ? jsonError(503, "organization_unavailable")
    : null;
}
