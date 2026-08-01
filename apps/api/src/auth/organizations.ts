import { Effect } from "effect";
import { Organizations } from "@tunnel/core";
import { Schemas } from "@tunnel/core";
import { runCore } from "../runtime.js";
import type { Env } from "../env.js";

export type OrganizationMembershipView = Schemas.OrganizationMembershipView;

export async function listOrganizationsForUser(
  env: Env,
  userId: string,
): Promise<readonly OrganizationMembershipView[]> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.listForUser(userId);
    }),
  );
}

export async function organizationForMember(
  env: Env,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.forMember(userId, organizationId);
    }),
  );
}

export async function createOrganizationForUser(
  env: Env,
  userId: string,
  name: string,
): Promise<OrganizationMembershipView> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.createForUser(userId, name);
    }),
  );
}

export async function ensureOrganizationForUser(env: Env, userId: string): Promise<string> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.ensureForUser(userId);
    }),
  );
}
