import type { Env } from "../env.js";

interface WorkosUser {
  readonly id: string;
  readonly email: string;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly email_verified: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function workosRequest(
  env: Env,
  path: string,
  init?: RequestInit,
  allowNotFound = false,
): Promise<unknown> {
  if (env.WORKOS_API_KEY === undefined) throw new Error("WORKOS_API_KEY is not configured");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${env.WORKOS_API_KEY}`);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`https://api.workos.com${path}`, { ...init, headers });
  const value: unknown = await response.json().catch((): null => null);
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`WorkOS request failed with status ${response.status}`);
  return value;
}

function parseUser(value: unknown): WorkosUser | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.email !== "string")
    return null;
  return {
    id: value.id,
    email: value.email,
    first_name: typeof value.first_name === "string" ? value.first_name : null,
    last_name: typeof value.last_name === "string" ? value.last_name : null,
    email_verified: value.email_verified === true,
  };
}

function membershipOrganizationId(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.data)) return null;
  for (const item of value.data) {
    if (
      isRecord(item) &&
      typeof item.organization_id === "string" &&
      (item.status === undefined || item.status === "active")
    )
      return item.organization_id;
  }
  return null;
}

function pendingInvitationOrganizationId(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.data)) return null;
  for (const item of value.data) {
    if (
      isRecord(item) &&
      item.state === "pending" &&
      typeof item.organization_id === "string"
    )
      return item.organization_id;
  }
  return null;
}

function organizationName(user: WorkosUser): string {
  const personName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return `${personName === "" ? user.email : personName}'s Organization`;
}

async function createPersonalOrganization(env: Env, user: WorkosUser): Promise<string> {
  const value = await workosRequest(env, "/organizations", {
    method: "POST",
    body: JSON.stringify({
      name: organizationName(user),
      external_id: `ztunnel-user:${user.id}`,
    }),
  });
  if (!isRecord(value) || typeof value.id !== "string")
    throw new Error("WorkOS returned an invalid organization");
  return value.id;
}

async function organizationForExternalId(env: Env, externalId: string): Promise<string | null> {
  const value = await workosRequest(
    env,
    `/organizations/external_id/${encodeURIComponent(externalId)}`,
    undefined,
    true,
  );
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}

// Only an explicit, admin-issued WorkOS invitation can place a user into an
// existing organization. Matching on email domain alone would let any two
// people who happen to share an email provider's domain end up in the same
// org and see each other's tunnels.
async function invitedOrganizationId(env: Env, email: string): Promise<string | null> {
  const query = new URLSearchParams({ email });
  return pendingInvitationOrganizationId(
    await workosRequest(env, `/user_management/invitations?${query.toString()}`),
  );
}

export async function ensureOrganizationForUser(env: Env, userId: string): Promise<string> {
  const memberships = await workosRequest(
    env,
    `/user_management/organization_memberships?user_id=${encodeURIComponent(userId)}&statuses[]=active`,
  );
  const existingMembership = membershipOrganizationId(memberships);
  if (existingMembership !== null) return existingMembership;

  const user = parseUser(
    await workosRequest(env, `/user_management/users/${encodeURIComponent(userId)}`),
  );
  if (user === null) throw new Error("WorkOS returned an invalid user");
  const separator = user.email.lastIndexOf("@");
  if (separator <= 0 || separator === user.email.length - 1)
    throw new Error("WorkOS user has an invalid email address");

  const invited = user.email_verified ? await invitedOrganizationId(env, user.email) : null;
  const externalId = `ztunnel-user:${user.id}`;
  let organizationId =
    invited ?? (await organizationForExternalId(env, externalId));
  if (organizationId === null) {
    try {
      organizationId = await createPersonalOrganization(env, user);
    } catch (error) {
      organizationId = await organizationForExternalId(env, externalId);
      if (organizationId === null) throw error;
    }
  }
  await workosRequest(env, "/user_management/organization_memberships", {
    method: "POST",
    body: JSON.stringify({ user_id: user.id, organization_id: organizationId }),
  });
  return organizationId;
}
