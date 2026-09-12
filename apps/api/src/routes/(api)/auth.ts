import { Effect } from "effect";
import { Workos } from "@tunnel/core";
import { mintAgentToken } from "../../auth/index.js";
import { authenticateUser, authErrorResponse, workosForm } from "../../auth/workos.js";
import type { Env } from "../../env.js";
import { runCore } from "../../runtime.js";
import { jsonError, jsonResponse } from "../../utils/json.js";
import { isValidTunnelId } from "../../utils/tunnel-id.js";

function validTokenBody(value: unknown): { readonly tunnelId: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const tunnelId = (value as Record<string, unknown>).tunnelId;
  if (typeof tunnelId !== "string" || !isValidTunnelId(tunnelId)) return null;
  return { tunnelId };
}

export async function handleToken(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
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

export async function proxyWorkosAuth(
  request: Request,
  env: Env,
  kind: "device" | "token" | "refresh",
): Promise<Response> {
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.AUTH_RATE_LIMITER.limit({ key: `${kind}:${clientIp}` });
  if (!success) return jsonError(429, "rate_limited");
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
    input.refreshToken !== ""
  ) {
    return refreshWorkosSession(env, input.refreshToken);
  } else return jsonError(400, "bad_request");
  return workosForm("authenticate", body);
}

function rotatedSession(value: unknown): { access_token: string; refresh_token: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { access_token: accessToken, refresh_token: refreshToken } = value as Record<
    string,
    unknown
  >;
  if (typeof accessToken !== "string" || accessToken === "") return null;
  if (typeof refreshToken !== "string" || refreshToken === "") return null;
  return { access_token: accessToken, refresh_token: refreshToken };
}

// WorkOS rotates the refresh token on every use, so the CLI depends on getting
// the new pair back verbatim and on telling a revoked session (401) apart from a
// server-side problem it should retry (5xx).
async function refreshWorkosSession(env: Env, refreshToken: string): Promise<Response> {
  if (env.WORKOS_API_KEY === undefined) return jsonError(500, "server_misconfigured");
  const refreshed = await runCore(
    env,
    Effect.gen(function* () {
      const workos = yield* Workos.Workos;
      return yield* workos.authenticate({ kind: "refresh", refreshToken });
    }),
  );
  if (refreshed.status === 400 || refreshed.status === 401) return jsonError(401, "invalid_grant");
  const rotated = refreshed.ok
    ? rotatedSession(await refreshed.json().catch((): null => null))
    : null;
  if (rotated === null) return jsonError(502, "upstream_error");
  return jsonResponse(rotated);
}
