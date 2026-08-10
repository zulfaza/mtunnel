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

export async function renameOrganizationForUser(
  env: Env,
  userId: string,
  organizationId: string,
  name: string,
): Promise<OrganizationMembershipView> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.renameForUser(userId, organizationId, name);
    }),
  );
}

export async function inviteOrganizationMemberForUser(
  env: Env,
  userId: string,
  organizationId: string,
  email: string,
): Promise<Schemas.OrganizationInvitationView> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.inviteForUser(userId, organizationId, email);
    }),
  );
}

export async function organizationSettingsForUser(
  env: Env,
  userId: string,
  organizationId: string,
): Promise<Schemas.OrganizationSettingsView> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.settingsForUser(userId, organizationId);
    }),
  );
}

export async function removeOrganizationMemberForUser(
  env: Env,
  userId: string,
  organizationId: string,
  membershipId: string,
): Promise<{ readonly membershipId: string }> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.removeMemberForUser(userId, organizationId, membershipId);
    }),
  );
}

export async function leaveOrganizationForUser(
  env: Env,
  userId: string,
  organizationId: string,
): Promise<{ readonly nextOrganizationId: string }> {
  return runCore(
    env,
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.leaveForUser(userId, organizationId);
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
