import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { LastOrganizationError } from "./errors.js";
import { Organizations, organizationsLayer } from "./organizations.js";
import { Workos } from "./workos.js";

interface RequestCall {
  readonly path: string;
  readonly method: string;
  readonly body: unknown;
}

function organizationMembership(
  membershipId: string,
  organizationId: string,
  organizationName: string,
  role: string,
) {
  return {
    id: membershipId,
    organization_id: organizationId,
    organization_name: organizationName,
    status: "active",
    role: { slug: role },
  };
}

function member(membershipId: string, organizationId: string, userId: string, email: string) {
  return {
    id: membershipId,
    user_id: userId,
    organization_id: organizationId,
    status: "active",
    role: { slug: "member" },
    user: {
      id: userId,
      email,
      first_name: "Ada",
      last_name: "Lovelace",
    },
  };
}

function requestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return null;
  return JSON.parse(body);
}

function layer(
  respond: (path: string, method: string, body: unknown) => unknown,
  calls: RequestCall[],
) {
  const workos = Workos.of({
    verifyAccessToken: () => Effect.succeed(null),
    request: (path, init) =>
      Effect.sync(() => {
        const method = init?.method ?? "GET";
        const body = requestBody(init?.body);
        calls.push({ path, method, body });
        return respond(path, method, body);
      }),
    form: () => Effect.succeed(new Response()),
    authenticate: () => Effect.succeed(new Response()),
    revokeSession: () => Effect.succeed(undefined),
  });
  return organizationsLayer.pipe(Layer.provide(Layer.succeed(Workos, workos)));
}

function run<A, E>(
  effect: Effect.Effect<A, E, Organizations>,
  respond: (path: string, method: string, body: unknown) => unknown,
  calls: RequestCall[] = [],
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(layer(respond, calls))));
}

describe("organizations", () => {
  it("parses membership identity and role", async () => {
    const membership = organizationMembership("om_1", "org_1", "Acme", "admin");

    await expect(
      run(
        Effect.gen(function* () {
          const organizations = yield* Organizations;
          return yield* organizations.listForUser("user_1");
        }),
        () => ({ data: [membership] }),
      ),
    ).resolves.toEqual([{ membershipId: "om_1", id: "org_1", name: "Acme", role: "admin" }]);
  });

  it("renames an organization after membership validation", async () => {
    const calls: RequestCall[] = [];
    const membership = organizationMembership("om_1", "org_1", "Acme", "admin");
    const result = await run(
      Effect.gen(function* () {
        const organizations = yield* Organizations;
        return yield* organizations.renameForUser("user_1", "org_1", "Acme Labs");
      }),
      (path) =>
        path.startsWith("/organizations/")
          ? { id: "org_1", name: "Acme Labs" }
          : { data: [membership] },
      calls,
    );

    expect(result.name).toBe("Acme Labs");
    expect(calls[1]).toEqual({
      path: "/organizations/org_1",
      method: "PUT",
      body: { name: "Acme Labs" },
    });
  });

  it("sends a member invitation for a joined organization", async () => {
    const calls: RequestCall[] = [];
    const membership = organizationMembership("om_1", "org_1", "Acme", "admin");
    const result = await run(
      Effect.gen(function* () {
        const organizations = yield* Organizations;
        return yield* organizations.inviteForUser("user_1", "org_1", "member@acme.test");
      }),
      (path) =>
        path === "/user_management/invitations"
          ? { id: "invitation_1", email: "member@acme.test", state: "pending" }
          : { data: [membership] },
      calls,
    );

    expect(result.state).toBe("pending");
    expect(calls[1]).toEqual({
      path: "/user_management/invitations",
      method: "POST",
      body: {
        email: "member@acme.test",
        organization_id: "org_1",
        role_slug: "member",
        inviter_user_id: "user_1",
      },
    });
  });

  it("returns settings for a joined organization", async () => {
    const membership = organizationMembership("om_1", "org_1", "Acme", "admin");
    const organizationMember = member("om_2", "org_1", "user_2", "ada@acme.test");

    await expect(
      run(
        Effect.gen(function* () {
          const organizations = yield* Organizations;
          return yield* organizations.settingsForUser("user_1", "org_1");
        }),
        (path) =>
          path.includes("organization_id=")
            ? { data: [organizationMember] }
            : { data: [membership] },
      ),
    ).resolves.toEqual({
      organization: { membershipId: "om_1", id: "org_1", name: "Acme", role: "admin" },
      members: [
        {
          membershipId: "om_2",
          userId: "user_2",
          name: "Ada Lovelace",
          email: "ada@acme.test",
          role: "member",
          status: "active",
        },
      ],
      organizationCount: 1,
    });
  });

  it("removes only a member of the selected organization", async () => {
    const calls: RequestCall[] = [];
    const membership = organizationMembership("om_1", "org_1", "Acme", "admin");
    const organizationMember = member("om_2", "org_1", "user_2", "ada@acme.test");
    const result = await run(
      Effect.gen(function* () {
        const organizations = yield* Organizations;
        return yield* organizations.removeMemberForUser("user_1", "org_1", "om_2");
      }),
      (path) =>
        path.endsWith("/om_2")
          ? null
          : path.includes("organization_id=")
            ? { data: [organizationMember] }
            : { data: [membership] },
      calls,
    );

    expect(result).toEqual({ membershipId: "om_2" });
    expect(calls[2]).toEqual({
      path: "/user_management/organization_memberships/om_2",
      method: "DELETE",
      body: null,
    });
  });

  it("prevents leaving the last organization", async () => {
    const membership = organizationMembership("om_1", "org_1", "Acme", "admin");

    await expect(
      run(
        Effect.gen(function* () {
          const organizations = yield* Organizations;
          return yield* organizations.leaveForUser("user_1", "org_1");
        }),
        () => ({ data: [membership] }),
      ),
    ).rejects.toBeInstanceOf(LastOrganizationError);
  });

  it("leaves an organization and returns a safe fallback", async () => {
    const calls: RequestCall[] = [];
    const first = organizationMembership("om_1", "org_1", "Acme", "admin");
    const second = organizationMembership("om_2", "org_2", "Personal", "member");
    const result = await run(
      Effect.gen(function* () {
        const organizations = yield* Organizations;
        return yield* organizations.leaveForUser("user_1", "org_1");
      }),
      (path) =>
        path.startsWith("/user_management/organization_memberships/")
          ? null
          : { data: [first, second] },
      calls,
    );

    expect(result).toEqual({ nextOrganizationId: "org_2" });
    expect(calls[1]).toEqual({
      path: "/user_management/organization_memberships/om_1",
      method: "DELETE",
      body: null,
    });
  });
});
