import { Context, Effect, Layer, Schema } from "effect";
import {
  ForbiddenError,
  LastOrganizationError,
  OrganizationCreateError,
  OrganizationInviteError,
  OrganizationLeaveError,
  OrganizationMemberRemoveError,
  OrganizationUpdateError,
} from "./errors.js";
import { Workos, WorkosRequestError } from "./workos.js";
import type {
  OrganizationInvitationView,
  OrganizationMemberView,
  OrganizationMembershipView,
  OrganizationSettingsView,
} from "./schemas.js";

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
  id: Schema.optionalKey(Schema.String),
  user_id: Schema.optionalKey(Schema.String),
  organization_id: Schema.String,
  organization_name: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  role: Schema.optionalKey(Schema.Struct({ slug: Schema.String })),
  roles: Schema.optionalKey(Schema.Array(Schema.Struct({ slug: Schema.String }))),
  user: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      email: Schema.String,
      first_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      last_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});
const MembershipResponse = Schema.Struct({ data: Schema.Array(Membership) });
const PendingInvitation = Schema.Struct({
  state: Schema.String,
  organization_id: Schema.String,
});
const InvitationResponse = Schema.Struct({ data: Schema.Array(PendingInvitation) });
const Organization = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
});
const OrganizationInvitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  state: Schema.String,
});

const decodeUser = Schema.decodeUnknownOption(WorkosUser);
const decodeMemberships = Schema.decodeUnknownOption(MembershipResponse);
const decodeInvitations = Schema.decodeUnknownOption(InvitationResponse);
const decodeOrganization = Schema.decodeUnknownOption(Organization);
const decodeMembership = Schema.decodeUnknownOption(Membership);
const decodeInvitation = Schema.decodeUnknownOption(OrganizationInvitation);

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
      : item.id === undefined || item.organization_name === undefined
        ? []
        : [membershipView(item.id, item.organization_id, item.organization_name, item)],
  );
}

function membershipView(
  membershipId: string,
  organizationId: string,
  name: string,
  membership: typeof Membership.Type,
): OrganizationMembershipView {
  return {
    membershipId,
    id: organizationId,
    name,
    role: membership.role?.slug ?? membership.roles?.[0]?.slug ?? "member",
  };
}

function organizationMembers(input: unknown): readonly OrganizationMemberView[] {
  const decoded = decodeMemberships(input);
  if (decoded._tag === "None") return [];
  return decoded.value.data.flatMap((membership): readonly OrganizationMemberView[] => {
    const membershipId = membership.id;
    const user = membership.user;
    const userId = membership.user_id ?? user?.id;
    if (membershipId === undefined || user === undefined || userId === undefined) return [];
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    return [
      {
        membershipId,
        userId,
        name: name === "" ? user.email : name,
        email: user.email,
        role: membership.role?.slug ?? membership.roles?.[0]?.slug ?? "member",
        status: membership.status ?? "active",
      },
    ];
  });
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
    readonly renameForUser: (
      userId: string,
      organizationId: string,
      name: string,
    ) => Effect.Effect<
      OrganizationMembershipView,
      WorkosRequestError | ForbiddenError | OrganizationUpdateError
    >;
    readonly inviteForUser: (
      userId: string,
      organizationId: string,
      email: string,
    ) => Effect.Effect<
      OrganizationInvitationView,
      WorkosRequestError | ForbiddenError | OrganizationInviteError
    >;
    readonly settingsForUser: (
      userId: string,
      organizationId: string,
    ) => Effect.Effect<OrganizationSettingsView, WorkosRequestError | ForbiddenError>;
    readonly removeMemberForUser: (
      userId: string,
      organizationId: string,
      membershipId: string,
    ) => Effect.Effect<
      { readonly membershipId: string },
      WorkosRequestError | ForbiddenError | OrganizationMemberRemoveError
    >;
    readonly leaveForUser: (
      userId: string,
      organizationId: string,
    ) => Effect.Effect<
      { readonly nextOrganizationId: string },
      WorkosRequestError | ForbiddenError | LastOrganizationError | OrganizationLeaveError
    >;
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

    const membershipForUser = Effect.fn("organizations.membership_for_user")(function* (
      userId: string,
      organizationId: string,
    ) {
      const memberships = yield* listForUser(userId);
      return memberships.find((membership) => membership.id === organizationId) ?? null;
    });

    const membersForOrganization = Effect.fn("organizations.members_for_organization")(function* (
      organizationId: string,
    ) {
      return organizationMembers(
        yield* workos.request(
          `/user_management/organization_memberships?organization_id=${encodeURIComponent(organizationId)}&statuses[]=active`,
        ),
      );
    });

    const settingsForUser = Effect.fn("organizations.settings_for_user")(function* (
      userId: string,
      organizationId: string,
    ) {
      const memberships = yield* listForUser(userId);
      const organization = memberships.find((membership) => membership.id === organizationId);
      if (organization === undefined) return yield* Effect.fail(new ForbiddenError({}));
      return {
        organization,
        members: yield* membersForOrganization(organizationId),
        organizationCount: memberships.length,
      };
    });

    const removeMemberForUser = Effect.fn("organizations.remove_member_for_user")(function* (
      userId: string,
      organizationId: string,
      membershipId: string,
    ) {
      const settings = yield* settingsForUser(userId, organizationId);
      const member = settings.members.find((candidate) => candidate.membershipId === membershipId);
      if (member === undefined || member.userId === userId)
        return yield* Effect.fail(new ForbiddenError({}));
      const result = yield* Effect.result(
        workos.request(
          `/user_management/organization_memberships/${encodeURIComponent(membershipId)}`,
          { method: "DELETE" },
        ),
      );
      if (result._tag === "Failure")
        return yield* Effect.fail(new OrganizationMemberRemoveError({}));
      return { membershipId };
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
          const membershipValue = yield* workos.request(
            "/user_management/organization_memberships",
            {
              method: "POST",
              body: JSON.stringify({ user_id: userId, organization_id: decoded.value.id }),
            },
          );
          const membership = decodeMembership(membershipValue);
          if (membership._tag === "None" || membership.value.id === undefined)
            return yield* Effect.fail(new OrganizationCreateError({}));
          return membershipView(membership.value.id, decoded.value.id, name, membership.value);
        }),
      );
      if (result._tag === "Failure") {
        if (result.failure instanceof OrganizationCreateError)
          return yield* Effect.fail(result.failure);
        return yield* Effect.fail(new OrganizationCreateError({}));
      }
      return result.success;
    });

    const renameForUser = Effect.fn("organizations.rename_for_user")(function* (
      userId: string,
      organizationId: string,
      name: string,
    ) {
      const membership = yield* membershipForUser(userId, organizationId);
      if (membership === null) return yield* Effect.fail(new ForbiddenError({}));
      const result = yield* Effect.result(
        workos.request(`/organizations/${encodeURIComponent(organizationId)}`, {
          method: "PUT",
          body: JSON.stringify({ name }),
        }),
      );
      if (result._tag === "Failure") return yield* Effect.fail(new OrganizationUpdateError({}));
      const organization = decodeOrganization(result.success);
      if (organization._tag === "None") return yield* Effect.fail(new OrganizationUpdateError({}));
      return { ...membership, name: organization.value.name ?? name };
    });

    const inviteForUser = Effect.fn("organizations.invite_for_user")(function* (
      userId: string,
      organizationId: string,
      email: string,
    ) {
      if ((yield* membershipForUser(userId, organizationId)) === null)
        return yield* Effect.fail(new ForbiddenError({}));
      const result = yield* Effect.result(
        workos.request("/user_management/invitations", {
          method: "POST",
          body: JSON.stringify({
            email,
            organization_id: organizationId,
            role_slug: "member",
            inviter_user_id: userId,
          }),
        }),
      );
      if (result._tag === "Failure") return yield* Effect.fail(new OrganizationInviteError({}));
      const invitation = decodeInvitation(result.success);
      if (invitation._tag === "None") return yield* Effect.fail(new OrganizationInviteError({}));
      return invitation.value;
    });

    const leaveForUser = Effect.fn("organizations.leave_for_user")(function* (
      userId: string,
      organizationId: string,
    ) {
      const memberships = yield* listForUser(userId);
      const membership = memberships.find((item) => item.id === organizationId);
      if (membership === undefined) return yield* Effect.fail(new ForbiddenError({}));
      const next = memberships.find((item) => item.id !== organizationId);
      if (next === undefined) return yield* Effect.fail(new LastOrganizationError({}));
      const result = yield* Effect.result(
        workos.request(
          `/user_management/organization_memberships/${encodeURIComponent(membership.membershipId)}`,
          { method: "DELETE" },
        ),
      );
      if (result._tag === "Failure") return yield* Effect.fail(new OrganizationLeaveError({}));
      return { nextOrganizationId: next.id };
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

    return Organizations.of({
      ensureForUser,
      listForUser,
      forMember,
      createForUser,
      renameForUser,
      inviteForUser,
      settingsForUser,
      removeMemberForUser,
      leaveForUser,
    });
  }),
);
