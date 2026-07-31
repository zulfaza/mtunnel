import type { Env } from "./env.js";

export interface OrganizationLimits {
  readonly maximumCustomDomains: number | null;
  readonly maximumActiveTunnels: number | null;
  readonly idleTimeoutSeconds: number;
  readonly maximumTunnelLifetimeSeconds: number;
  readonly maximumPreviews: number | null;
  readonly maximumPreviewBytes: number | null;
  readonly maximumPreviewFileBytes: number;
  readonly maximumPreviewFiles: number | null;
  readonly previewTTLSeconds: number;
}

const RESTRICTED_LIMITS: OrganizationLimits = {
  maximumCustomDomains: 1,
  maximumActiveTunnels: 3,
  idleTimeoutSeconds: 15 * 60,
  maximumTunnelLifetimeSeconds: 60 * 60,
  maximumPreviews: 20,
  maximumPreviewBytes: 2 * 1024 * 1024 * 1024,
  maximumPreviewFileBytes: 100 * 1024 * 1024,
  maximumPreviewFiles: 500,
  previewTTLSeconds: 7 * 24 * 60 * 60,
};

const UNRESTRICTED_LIMITS: OrganizationLimits = {
  maximumCustomDomains: null,
  maximumActiveTunnels: null,
  idleTimeoutSeconds: 0,
  maximumTunnelLifetimeSeconds: 0,
  maximumPreviews: null,
  maximumPreviewBytes: null,
  maximumPreviewFileBytes: 100 * 1024 * 1024,
  maximumPreviewFiles: null,
  previewTTLSeconds: 30 * 24 * 60 * 60,
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
