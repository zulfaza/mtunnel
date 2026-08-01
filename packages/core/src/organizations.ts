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
const OrganizationDomain = Schema.Struct({ domain: Schema.String, state: Schema.String });
const Organization = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  domain_data: Schema.optionalKey(Schema.Array(OrganizationDomain)),
});
const OrganizationResponse = Schema.Struct({ data: Schema.Array(Organization) });

const decodeUser = Schema.decodeUnknownOption(WorkosUser);
const decodeMemberships = Schema.decodeUnknownOption(MembershipResponse);
const decodeInvitations = Schema.decodeUnknownOption(InvitationResponse);
const decodeOrganizations = Schema.decodeUnknownOption(OrganizationResponse);
const decodeOrganization = Schema.decodeUnknownOption(Organization);

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "mail.com",
  "gmx.com",
  "yandex.com",
  "zoho.com",
  "fastmail.com",
]);

function organizationName(user: WorkosUser): string {
  const personName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return `${personName === "" ? user.email : personName}'s Organization`;
}

function companyDomain(email: string): string | null {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return PUBLIC_EMAIL_DOMAINS.has(domain) ? null : domain;
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
  const memberships = activeMemberships(input);
  return memberships[0]?.id ?? null;
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

    const domainOrganizationId = Effect.fn("organizations.by_domain")(function* (domain: string) {
      const query = new URLSearchParams();
      query.append("domains", domain);
      const value = yield* workos.request(`/organizations?${query.toString()}`);
      const decoded = decodeOrganizations(value);
      if (decoded._tag === "None") return null;
      return (
        decoded.value.data.find((organization) =>
          organization.domain_data?.some(
            (entry) => entry.domain === domain && entry.state === "verified",
          ),
        )?.id ?? null
      );
    });

    const createPersonalOrganization = Effect.fn("organizations.create_personal")(function* (
      user: WorkosUser,
    ) {
      const domain = user.email_verified ? companyDomain(user.email) : null;
      const value = yield* workos.request("/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: organizationName(user),
          external_id: `ztunnel-user:${user.id}`,
          ...(domain === null ? {} : { domain_data: [{ domain, state: "verified" }] }),
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
      const domain = user.email_verified ? companyDomain(user.email) : null;
      const domainMatched =
        invited === null && domain !== null ? yield* domainOrganizationId(domain) : null;
      const externalId = `ztunnel-user:${user.id}`;
      let organizationId =
        invited ?? domainMatched ?? (yield* organizationForExternalId(externalId));
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
