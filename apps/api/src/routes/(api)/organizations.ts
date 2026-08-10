import { Schema } from "effect";
import { Errors, Schemas } from "@tunnel/core";
import { authenticateUser, authErrorResponse } from "../../auth/workos.js";
import {
  createOrganizationForUser,
  inviteOrganizationMemberForUser,
  leaveOrganizationForUser,
  listOrganizationsForUser,
  organizationSettingsForUser,
  removeOrganizationMemberForUser,
  renameOrganizationForUser,
} from "../../auth/organizations.js";
import type { Env } from "../../env.js";
import { jsonError, jsonResponse } from "../../utils/json.js";

const decodeOrganizationCreate = Schema.decodeUnknownOption(Schemas.OrganizationCreateRequest);
const decodeOrganizationRename = Schema.decodeUnknownOption(Schemas.OrganizationRenameRequest);
const decodeOrganizationInvite = Schema.decodeUnknownOption(Schemas.OrganizationInviteRequest);

export type OrganizationRoute =
  | { readonly action: "detail"; readonly organizationId: string }
  | { readonly action: "invitations"; readonly organizationId: string }
  | { readonly action: "membership"; readonly organizationId: string }
  | { readonly action: "members"; readonly organizationId: string }
  | {
      readonly action: "member";
      readonly organizationId: string;
      readonly membershipId: string;
    };

export function organizationRoute(pathname: string): OrganizationRoute | null {
  const matched =
    /^\/api\/v1\/organizations\/([^/]+)(?:\/(invitations|membership|members)(?:\/([^/]+))?)?$/u.exec(
      pathname,
    );
  const encodedOrganizationId = matched?.[1];
  if (encodedOrganizationId === undefined) return null;
  let organizationId: string;
  try {
    organizationId = decodeURIComponent(encodedOrganizationId);
  } catch {
    return null;
  }
  if (organizationId === "") return null;
  const action = matched?.[2];
  if (action === "invitations") return { action, organizationId };
  if (action === "membership") return { action, organizationId };
  if (action === "members") {
    const encodedMembershipId = matched?.[3];
    if (encodedMembershipId === undefined) return { action, organizationId };
    try {
      const membershipId = decodeURIComponent(encodedMembershipId);
      return membershipId === "" ? null : { action: "member", organizationId, membershipId };
    } catch {
      return null;
    }
  }
  return { action: "detail", organizationId };
}

async function requestValue(request: Request): Promise<unknown> {
  return request.json().catch((): null => null);
}

function organizationFailure(cause: unknown, fallback: string): Response {
  if (cause instanceof Errors.ForbiddenError) return jsonError(403, cause.code);
  if (cause instanceof Errors.LastOrganizationError) return jsonError(409, cause.code);
  if (
    cause instanceof Errors.OrganizationUpdateError ||
    cause instanceof Errors.OrganizationInviteError ||
    cause instanceof Errors.OrganizationLeaveError ||
    cause instanceof Errors.OrganizationMemberRemoveError
  )
    return jsonError(502, cause.code);
  return jsonError(502, fallback);
}

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
  const decoded = decodeOrganizationCreate(await requestValue(request));
  if (decoded._tag === "None") return jsonError(400, "bad_request");
  const name = decoded.value.name.trim();
  if (name === "") return jsonError(400, "bad_request");
  try {
    const organization = await createOrganizationForUser(env, auth.userId, name);
    return jsonResponse(organization, 201);
  } catch {
    return jsonError(502, "organization_create_failed");
  }
}

export async function handleOrganizationRename(
  request: Request,
  env: Env,
  organizationId: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  const value = await requestValue(request);
  const name =
    typeof value === "object" && value !== null && "name" in value ? value.name : undefined;
  const decoded = decodeOrganizationRename({ organizationId, name });
  if (decoded._tag === "None" || decoded.value.name.trim() === "")
    return jsonError(400, "bad_request");
  try {
    return jsonResponse(
      await renameOrganizationForUser(env, auth.userId, organizationId, decoded.value.name.trim()),
    );
  } catch (cause) {
    return organizationFailure(cause, "organization_update_failed");
  }
}

export async function handleOrganizationInvite(
  request: Request,
  env: Env,
  organizationId: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  const value = await requestValue(request);
  const email =
    typeof value === "object" && value !== null && "email" in value ? value.email : undefined;
  const decoded = decodeOrganizationInvite({ organizationId, email });
  if (decoded._tag === "None") return jsonError(400, "bad_request");
  try {
    return jsonResponse(
      await inviteOrganizationMemberForUser(
        env,
        auth.userId,
        organizationId,
        decoded.value.email.toLowerCase(),
      ),
      201,
    );
  } catch (cause) {
    return organizationFailure(cause, "organization_invite_failed");
  }
}

export async function handleOrganizationMembers(
  request: Request,
  env: Env,
  organizationId: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  try {
    const settings = await organizationSettingsForUser(env, auth.userId, organizationId);
    return jsonResponse({ members: settings.members });
  } catch (cause) {
    return organizationFailure(cause, "organization_members_failed");
  }
}

export async function handleOrganizationMemberRemove(
  request: Request,
  env: Env,
  organizationId: string,
  membershipId: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  try {
    return jsonResponse(
      await removeOrganizationMemberForUser(env, auth.userId, organizationId, membershipId),
    );
  } catch (cause) {
    return organizationFailure(cause, "organization_member_remove_failed");
  }
}

export async function handleOrganizationLeave(
  request: Request,
  env: Env,
  organizationId: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  try {
    const result = await leaveOrganizationForUser(env, auth.userId, organizationId);
    return jsonResponse({
      ...result,
      currentOrganizationId:
        auth.organizationId === organizationId ? result.nextOrganizationId : auth.organizationId,
    });
  } catch (cause) {
    return organizationFailure(cause, "organization_leave_failed");
  }
}
