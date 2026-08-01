import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { Access, Domains, Schemas } from "@tunnel/core";
import { requireUser } from "./session.js";
import { runCore } from "./runtime.js";

export const listDomains = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return runCore(
    Effect.gen(function* () {
      const domains = yield* Domains.CustomDomains;
      return yield* domains.list(user.organizationId, user.userId);
    }),
  );
});

export const addDomain = createServerFn({ method: "POST" })
  .validator((data: { readonly hostname: string; readonly tunnelId: string }) => data)
  .handler(async ({ data }) => {
    const hostname = data.hostname.trim().toLowerCase();
    const tunnelId = data.tunnelId.trim();
    if (!Schemas.isValidHostname(hostname) || !Schemas.isValidTunnelId(tunnelId))
      throw new Error("invalid_domain_request");
    const user = await requireUser();
    return runCore(
      Effect.gen(function* () {
        const limits = yield* Access.AccessLimits;
        const maximumDomains = (yield* limits.limitsForOrganization(user.organizationId))
          .maximumCustomDomains;
        const domains = yield* Domains.CustomDomains;
        return yield* domains.add({
          hostname,
          tunnelId,
          organizationId: user.organizationId,
          userId: user.userId,
          maximumDomains,
        });
      }),
    );
  });

export const verifyDomain = createServerFn({ method: "POST" })
  .validator((data: { readonly hostname: string }) => data)
  .handler(async ({ data }) => runDomainAction(data.hostname, "verify"));

export const refreshDomain = createServerFn({ method: "POST" })
  .validator((data: { readonly hostname: string }) => data)
  .handler(async ({ data }) => runDomainAction(data.hostname, "status"));

export const deleteDomain = createServerFn({ method: "POST" })
  .validator((data: { readonly hostname: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return runCore(
      Effect.gen(function* () {
        const domains = yield* Domains.CustomDomains;
        return yield* domains.delete(data.hostname, user.organizationId, user.userId);
      }),
    );
  });

async function runDomainAction(hostname: string, action: "verify" | "status") {
  const user = await requireUser();
  return runCore(
    Effect.gen(function* () {
      const domains = yield* Domains.CustomDomains;
      return yield* domains[action](hostname, user.organizationId, user.userId);
    }),
  );
}
