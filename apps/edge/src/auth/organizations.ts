import type { Env } from "../env.js";

interface WorkosUser {
  readonly id: string;
  readonly email: string;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly email_verified: boolean;
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

function parseUser(input: unknown): WorkosUser | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.email !== "string") return null;
  return {
    id: value.id,
    email: value.email,
    first_name: typeof value.first_name === "string" ? value.first_name : null,
    last_name: typeof value.last_name === "string" ? value.last_name : null,
    email_verified: value.email_verified === true,
  };
}

function membershipOrganizationId(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const data = (input as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.organization_id === "string" &&
      (record.status === undefined || record.status === "active")
    )
      return record.organization_id;
  }
  return null;
}

function pendingInvitationOrganizationId(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const data = (input as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.state === "pending" && typeof record.organization_id === "string")
      return record.organization_id;
  }
  return null;
}

function organizationName(user: WorkosUser): string {
  const personName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return `${personName === "" ? user.email : personName}'s Organization`;
}

// Free/personal email providers must never be used to group users into an
// organization: two strangers who happen to share a Gmail-style provider
// are not a company, and auto-joining them would leak each other's tunnels.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "mail.com",
  "gmx.com",
  "yandex.com",
  "zoho.com",
  "fastmail.com",
]);

function companyDomain(email: string): string | null {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return PUBLIC_EMAIL_DOMAINS.has(domain) ? null : domain;
}

async function createPersonalOrganization(env: Env, user: WorkosUser): Promise<string> {
  const domain = user.email_verified ? companyDomain(user.email) : null;
  const value = await workosRequest(env, "/organizations", {
    method: "POST",
    body: JSON.stringify({
      name: organizationName(user),
      external_id: `ztunnel-user:${user.id}`,
      ...(domain === null ? {} : { domain_data: [{ domain, state: "verified" }] }),
    }),
  });
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("WorkOS returned an invalid organization");
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== "string") throw new Error("WorkOS returned an invalid organization");
  return id;
}

async function organizationForExternalId(env: Env, externalId: string): Promise<string | null> {
  const value = await workosRequest(
    env,
    `/organizations/external_id/${encodeURIComponent(externalId)}`,
    undefined,
    true,
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

// An explicit, admin-issued WorkOS invitation can place a user into an
// existing organization regardless of email domain.
async function invitedOrganizationId(env: Env, email: string): Promise<string | null> {
  const query = new URLSearchParams({ email });
  return pendingInvitationOrganizationId(
    await workosRequest(env, `/user_management/invitations?${query.toString()}`),
  );
}

function verifiedDomainOrganizationId(input: unknown, domain: string): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const data = (input as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const domainData = record.domain_data;
    if (typeof record.id !== "string" || !Array.isArray(domainData)) continue;
    const matches = domainData.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>).domain === domain &&
        (entry as Record<string, unknown>).state === "verified",
    );
    if (matches) return record.id;
  }
  return null;
}

// A company domain (never a free provider, see PUBLIC_EMAIL_DOMAINS) that's
// registered as verified on an org lets any new user with a matching,
// provider-verified email auto-join that org, so teammates end up together
// without needing an invitation.
async function domainOrganizationId(env: Env, domain: string): Promise<string | null> {
  const query = new URLSearchParams();
  query.append("domains", domain);
  return verifiedDomainOrganizationId(
    await workosRequest(env, `/organizations?${query.toString()}`),
    domain,
  );
}

export interface OrganizationMembershipView {
  readonly id: string;
  readonly name: string;
}

function activeMembershipList(input: unknown): readonly OrganizationMembershipView[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return [];
  const data = (input as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): readonly OrganizationMembershipView[] => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.organization_id !== "string" ||
      typeof record.organization_name !== "string" ||
      (record.status !== undefined && record.status !== "active")
    )
      return [];
    return [{ id: record.organization_id, name: record.organization_name }];
  });
}

export async function listOrganizationsForUser(
  env: Env,
  userId: string,
): Promise<readonly OrganizationMembershipView[]> {
  return activeMembershipList(
    await workosRequest(
      env,
      `/user_management/organization_memberships?user_id=${encodeURIComponent(userId)}&statuses[]=active`,
    ),
  );
}

// Verifies the requested org against the user's actual memberships rather
// than trusting a client-supplied id outright, since org ids aren't secret.
export async function organizationForMember(
  env: Env,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const memberships = await listOrganizationsForUser(env, userId);
  return memberships.some((membership) => membership.id === organizationId)
    ? organizationId
    : null;
}

export async function createOrganizationForUser(
  env: Env,
  userId: string,
  name: string,
): Promise<OrganizationMembershipView> {
  const value = await workosRequest(env, "/organizations", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("WorkOS returned an invalid organization");
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== "string") throw new Error("WorkOS returned an invalid organization");
  await workosRequest(env, "/user_management/organization_memberships", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, organization_id: id }),
  });
  return { id, name };
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
  const domain = user.email_verified ? companyDomain(user.email) : null;
  const domainMatched =
    invited === null && domain !== null ? await domainOrganizationId(env, domain) : null;
  const externalId = `ztunnel-user:${user.id}`;
  let organizationId =
    invited ?? domainMatched ?? (await organizationForExternalId(env, externalId));
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
