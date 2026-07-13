import { mintAgentToken } from "../../auth/index.js";
import { authenticateUser, authErrorResponse, workosForm } from "../../auth/workos.js";
import type { Env } from "../../env.js";
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
