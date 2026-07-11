import type { Env } from "../env.js";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com",
  "fastmail.com",
  "gmx.com",
  "gmx.net",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "tutanota.com",
  "tuta.com",
  "yandex.com",
  "yahoo.com",
  "ymail.com",
]);

interface WorkosUser {
  readonly id: string;
  readonly email: string;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly email_verified: boolean;
}

interface WorkosOrganization {
  readonly id: string;
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

function organizationsFromList(value: unknown): readonly WorkosOrganization[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.flatMap((item): readonly WorkosOrganization[] =>
    isRecord(item) && typeof item.id === "string" ? [{ id: item.id }] : [],
  );
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

function organizationName(user: WorkosUser, domain: string | null): string {
  if (domain !== null) return domain;
  const personName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return `${personName === "" ? user.email : personName}'s Organization`;
}

async function createOrganization(
  env: Env,
  user: WorkosUser,
  domain: string | null,
): Promise<string> {
  const body: Record<string, unknown> = {
    name: organizationName(user, domain),
    external_id: domain === null ? `ztunnel-user:${user.id}` : `ztunnel-domain:${domain}`,
  };
  if (domain !== null) body.domain_data = [{ domain, state: "pending" }];
  const value = await workosRequest(env, "/organizations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!isRecord(value) || typeof value.id !== "string")
    throw new Error("WorkOS returned an invalid organization");
  return value.id;
}

async function organizationForDomain(env: Env, domain: string): Promise<string | null> {
  const query = new URLSearchParams();
  query.append("domains[]", domain);
  const organizations = organizationsFromList(
    await workosRequest(env, `/organizations?${query.toString()}`),
  );
  return organizations[0]?.id ?? null;
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
  const emailDomain = user.email.slice(separator + 1).toLowerCase();
  const organizationDomain =
    user.email_verified && !PERSONAL_EMAIL_DOMAINS.has(emailDomain) ? emailDomain : null;
  const externalId =
    organizationDomain === null
      ? `ztunnel-user:${user.id}`
      : `ztunnel-domain:${organizationDomain}`;
  let organizationId =
    organizationDomain === null
      ? await organizationForExternalId(env, externalId)
      : await organizationForDomain(env, organizationDomain);
  if (organizationId === null) {
    try {
      organizationId = await createOrganization(env, user, organizationDomain);
    } catch (error) {
      organizationId =
        organizationDomain === null
          ? await organizationForExternalId(env, externalId)
          : await organizationForDomain(env, organizationDomain);
      if (organizationId === null) throw error;
    }
  }
  await workosRequest(env, "/user_management/organization_memberships", {
    method: "POST",
    body: JSON.stringify({ user_id: user.id, organization_id: organizationId }),
  });
  return organizationId;
}
