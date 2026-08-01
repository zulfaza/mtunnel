import { Context, Effect, Layer, Schema } from "effect";
import { DomainsDatabase } from "./bindings.js";
import { OrganizationLimits } from "./schemas.js";

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

const AccessRow = Schema.Struct({ unrestricted: Schema.Number });
const decodeAccessRow = Schema.decodeUnknownOption(AccessRow);

export class AccessLimits extends Context.Service<
  AccessLimits,
  { readonly limitsForOrganization: (organizationId: string) => Effect.Effect<OrganizationLimits> }
>()("@tunnel/core/access/AccessLimits") {}

export const accessLimitsLayer = Layer.effect(
  AccessLimits,
  Effect.gen(function* () {
    const domains = yield* DomainsDatabase;
    const limitsForOrganization = Effect.fn("access.limits_for_organization")(function* (
      organizationId: string,
    ) {
      const row = yield* Effect.promise(() =>
        domains
          .prepare("SELECT unrestricted FROM organization_access WHERE organization_id = ?")
          .bind(organizationId)
          .first(),
      );
      const parsed = decodeAccessRow(row);
      return parsed._tag === "Some" && parsed.value.unrestricted === 1
        ? UNRESTRICTED_LIMITS
        : RESTRICTED_LIMITS;
    });
    return AccessLimits.of({ limitsForOrganization });
  }),
);
