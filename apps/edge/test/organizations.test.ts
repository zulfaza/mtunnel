import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureOrganizationForUser } from "../src/auth/organizations.js";
import type { Env } from "../src/env.js";

const env = { WORKOS_API_KEY: "sk_test" } as Env;

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number): unknown {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) throw new Error(`Missing fetch call ${index}`);
  return JSON.parse((call[1] as RequestInit).body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("organization assignment", () => {
  it("reuses the user's active organization membership", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ data: [{ organization_id: "org_existing", status: "active" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureOrganizationForUser(env, "user_1")).resolves.toBe("org_existing");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("joins a user with a pending invitation to the invited organization", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(
        response({ id: "user_1", email: "person@acme.test", email_verified: true }),
      )
      .mockResolvedValueOnce(
        response({ data: [{ state: "pending", organization_id: "org_acme" }] }),
      )
      .mockResolvedValueOnce(response({ id: "membership_1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureOrganizationForUser(env, "user_1")).resolves.toBe("org_acme");
    expect(requestBody(fetchMock, 3)).toEqual({
      user_id: "user_1",
      organization_id: "org_acme",
    });
  });

  it("does not join a shared-domain organization without an invitation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(
        response({ id: "user_1", email: "person@acme.test", email_verified: true }),
      )
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response(null, 404))
      .mockResolvedValueOnce(response({ id: "org_personal" }))
      .mockResolvedValueOnce(response({ id: "membership_1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureOrganizationForUser(env, "user_1")).resolves.toBe("org_personal");
    expect(requestBody(fetchMock, 4)).toEqual({
      name: "person@acme.test's Organization",
      external_id: "ztunnel-user:user_1",
    });
  });

  it("creates a personal organization for a generic email address", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(
        response({
          id: "user_2",
          email: "person@gmail.com",
          email_verified: true,
          first_name: "Ada",
        }),
      )
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response(null, 404))
      .mockResolvedValueOnce(response({ id: "org_personal" }))
      .mockResolvedValueOnce(response({ id: "membership_2" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureOrganizationForUser(env, "user_2")).resolves.toBe("org_personal");
    expect(requestBody(fetchMock, 4)).toEqual({
      name: "Ada's Organization",
      external_id: "ztunnel-user:user_2",
    });
  });
});
