import type { Env } from "./env.js";

export interface OrganizationLimits {
  readonly maximumCustomDomains: number | null;
  readonly maximumActiveTunnels: number | null;
  readonly idleTimeoutSeconds: number;
  readonly maximumTunnelLifetimeSeconds: number;
}

const RESTRICTED_LIMITS: OrganizationLimits = {
  maximumCustomDomains: 1,
  maximumActiveTunnels: 3,
  idleTimeoutSeconds: 15 * 60,
  maximumTunnelLifetimeSeconds: 60 * 60,
};

const UNRESTRICTED_LIMITS: OrganizationLimits = {
  maximumCustomDomains: null,
  maximumActiveTunnels: null,
  idleTimeoutSeconds: 0,
  maximumTunnelLifetimeSeconds: 0,
};

export async function limitsForOrganization(
  env: Env,
  organizationId: string,
): Promise<OrganizationLimits> {
  const row = await env.DOMAINS.prepare(
    "SELECT unrestricted FROM organization_access WHERE organization_id = ?",
  )
    .bind(organizationId)
    .first<{ unrestricted: number }>();
  return row?.unrestricted === 1 ? UNRESTRICTED_LIMITS : RESTRICTED_LIMITS;
}
