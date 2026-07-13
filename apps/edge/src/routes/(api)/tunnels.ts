import { authenticateUser, authErrorResponse } from "../../auth/workos.js";
import type { Env } from "../../env.js";
import { jsonError, jsonResponse } from "../../utils/json.js";
import { isValidTunnelId } from "../../utils/tunnel-id.js";

export async function handleTunnelStatus(
  request: Request,
  env: Env,
  tunnelId: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  if (!isValidTunnelId(tunnelId)) return jsonError(400, "bad_request");
  if (
    !(await env.REGISTRY.getByName("global").ownsTunnel(tunnelId, auth.organizationId, auth.userId))
  )
    return jsonError(404, "not_found");
  return jsonResponse(await env.TUNNELS.getByName(tunnelId).status(tunnelId));
}
