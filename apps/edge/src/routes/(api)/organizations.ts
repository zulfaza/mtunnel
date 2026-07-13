import { authenticateUser, authErrorResponse } from "../../auth/workos.js";
import { createOrganizationForUser, listOrganizationsForUser } from "../../auth/organizations.js";
import type { Env } from "../../env.js";
import { jsonError, jsonResponse } from "../../utils/json.js";

export async function handleOrganizationList(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  return jsonResponse({
    organizations: await listOrganizationsForUser(env, auth.userId),
    currentOrganizationId: auth.organizationId,
  });
}

export async function handleOrganizationCreate(request: Request, env: Env): Promise<Response> {
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
  const name = (value as Record<string, unknown>).name;
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 100)
    return jsonError(400, "bad_request");
  try {
    const organization = await createOrganizationForUser(env, auth.userId, name.trim());
    return jsonResponse(organization, 201);
  } catch {
    return jsonError(502, "organization_create_failed");
  }
}
