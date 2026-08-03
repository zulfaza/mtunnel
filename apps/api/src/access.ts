import { Effect } from "effect";
import { Access } from "@tunnel/core";
import type { OrganizationLimits } from "@tunnel/core/schemas";
import { runCore } from "./runtime.js";
import type { Env } from "./env.js";

export type { OrganizationLimits };

export async function limitsForOrganization(
  env: Env,
  organizationId: string,
): Promise<OrganizationLimits> {
  return runCore(
    env,
    Effect.gen(function* () {
      const accessLimits = yield* Access.AccessLimits;
      return yield* accessLimits.limitsForOrganization(organizationId);
    }),
  );
}
