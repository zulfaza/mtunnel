import { Context, Effect, Layer, Schema } from "effect";
import { OrganizationCreateError } from "./errors.js";
import { Workos, WorkosRequestError } from "./workos.js";
import type { OrganizationMembershipView } from "./schemas.js";

interface WorkosUser {
  readonly id: string;
  readonly email: string;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly email_verified: boolean;
}

const WorkosUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  first_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  last_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  email_verified: Schema.Boolean,
});
const Membership = Schema.Struct({
  organization_id: Schema.String,
  organization_name: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
});
const MembershipResponse = Schema.Struct({ data: Schema.Array(Membership) });
const Invitation = Schema.Struct({
  state: Schema.String,
  organization_id: Schema.String,
});
const InvitationResponse = Schema.Struct({ data: Schema.Array(Invitation) });
const Organization = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
});

const decodeUser = Schema.decodeUnknownOption(WorkosUser);
const decodeMemberships = Schema.decodeUnknownOption(MembershipResponse);
const decodeInvitations = Schema.decodeUnknownOption(InvitationResponse);
const decodeOrganization = Schema.decodeUnknownOption(Organization);

function organizationName(user: WorkosUser): string {
  const personName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return `${personName === "" ? user.email : personName}'s Organization`;
}

function activeMemberships(input: unknown): readonly OrganizationMembershipView[] {
  const decoded = decodeMemberships(input);
  if (decoded._tag === "None") return [];
  return decoded.value.data.flatMap((item): readonly OrganizationMembershipView[] =>
    item.status !== undefined && item.status !== "active"
      ? []
      : item.organization_name === undefined
        ? []
        : [{ id: item.organization_id, name: item.organization_name, role: "member" }],
  );
}

function firstOrganizationId(input: unknown): string | null {
  const decoded = decodeMemberships(input);
  if (decoded._tag === "None") return null;
  return (
    decoded.value.data.find((item) => item.status === undefined || item.status === "active")
      ?.organization_id ?? null
  );
}

function pendingInvitationOrganization(input: unknown): string | null {
  const decoded = decodeInvitations(input);
  if (decoded._tag === "None") return null;
  return decoded.value.data.find((entry) => entry.state === "pending")?.organization_id ?? null;
}

export class Organizations extends Context.Service<
  Organizations,
  {
    readonly ensureForUser: (userId: string) => Effect.Effect<string, WorkosRequestError>;
    readonly listForUser: (
      userId: string,
    ) => Effect.Effect<readonly OrganizationMembershipView[], WorkosRequestError>;
    readonly forMember: (
      userId: string,
      organizationId: string,
    ) => Effect.Effect<string | null, WorkosRequestError>;
    readonly createForUser: (
      userId: string,
      name: string,
    ) => Effect.Effect<OrganizationMembershipView, WorkosRequestError | OrganizationCreateError>;
  }
>()("@tunnel/core/auth/Organizations") {}

export const organizationsLayer = Layer.effect(
  Organizations,
  Effect.gen(function* () {
    const workos = yield* Workos;

    const organizationForExternalId = Effect.fn("organizations.for_external_id")(function* (
      externalId: string,
    ) {
      const value = yield* workos.request(
        `/organizations/external_id/${encodeURIComponent(externalId)}`,
        undefined,
        true,
      );
      const decoded = decodeOrganization(value);
      return decoded._tag === "Some" ? decoded.value.id : null;
    });

    const invitedOrganizationId = Effect.fn("organizations.invited")(function* (email: string) {
      const query = new URLSearchParams({ email });
      const value = yield* workos.request(`/user_management/invitations?${query.toString()}`);
      return pendingInvitationOrganization(value);
    });

    const createPersonalOrganization = Effect.fn("organizations.create_personal")(function* (
      user: WorkosUser,
    ) {
      const value = yield* workos.request("/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: organizationName(user),
          external_id: `ztunnel-user:${user.id}`,
        }),
      });
      const decoded = decodeOrganization(value);
      if (decoded._tag === "None")
        return yield* Effect.fail(
          new WorkosRequestError({ message: "WorkOS returned an invalid organization" }),
        );
      return decoded.value.id;
    });

    const listForUser = Effect.fn("organizations.list_for_user")(function* (userId: string) {
      return activeMemberships(
        yield* workos.request(
          `/user_management/organization_memberships?user_id=${encodeURIComponent(userId)}&statuses[]=active`,
        ),
      );
    });

    const forMember = Effect.fn("organizations.for_member")(function* (
      userId: string,
      organizationId: string,
    ) {
      const memberships = yield* listForUser(userId);
      return memberships.some((membership) => membership.id === organizationId)
        ? organizationId
        : null;
    });

    const createForUser = Effect.fn("organizations.create_for_user")(function* (
      userId: string,
      name: string,
    ) {
      const result = yield* Effect.result(
        Effect.gen(function* () {
          const value = yield* workos.request("/organizations", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
          const decoded = decodeOrganization(value);
          if (decoded._tag === "None") return yield* Effect.fail(new OrganizationCreateError({}));
          yield* workos.request("/user_management/organization_memberships", {
            method: "POST",
            body: JSON.stringify({ user_id: userId, organization_id: decoded.value.id }),
          });
          return { id: decoded.value.id, name, role: "member" };
        }),
      );
      if (result._tag === "Failure") {
        if (result.failure instanceof OrganizationCreateError)
          return yield* Effect.fail(result.failure);
        return yield* Effect.fail(new OrganizationCreateError({}));
      }
      return result.success;
    });

    const ensureForUser = Effect.fn("organizations.ensure_for_user")(function* (userId: string) {
      const memberships = yield* workos.request(
        `/user_management/organization_memberships?user_id=${encodeURIComponent(userId)}&statuses[]=active`,
      );
      const existingMembership = firstOrganizationId(memberships);
      if (existingMembership !== null) return existingMembership;
      const userResult = decodeUser(
        yield* workos.request(`/user_management/users/${encodeURIComponent(userId)}`),
      );
      if (userResult._tag === "None")
        return yield* Effect.fail(
          new WorkosRequestError({ message: "WorkOS returned an invalid user" }),
        );
      const user = userResult.value;
      const separator = user.email.lastIndexOf("@");
      if (separator <= 0 || separator === user.email.length - 1)
        return yield* Effect.fail(
          new WorkosRequestError({ message: "WorkOS user has an invalid email address" }),
        );
      const invited = user.email_verified ? yield* invitedOrganizationId(user.email) : null;
      const externalId = `ztunnel-user:${user.id}`;
      let organizationId = invited ?? (yield* organizationForExternalId(externalId));
      if (organizationId === null) {
        const created = yield* Effect.result(createPersonalOrganization(user));
        organizationId =
          created._tag === "Success"
            ? created.success
            : ((yield* organizationForExternalId(externalId)) ??
              (yield* Effect.fail(
                new WorkosRequestError({ message: "Unable to create organization" }),
              )));
      }
      yield* workos.request("/user_management/organization_memberships", {
        method: "POST",
        body: JSON.stringify({ user_id: user.id, organization_id: organizationId }),
      });
      return organizationId;
    });

    return Organizations.of({ ensureForUser, listForUser, forMember, createForUser });
  }),
);
