import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Env } from "../src/env.js";
import { proxyWorkosAuth } from "../src/routes/(api)/auth.js";

function environment(overrides: Partial<Env> = {}): Env {
  return {
    WORKOS_CLIENT_ID: "client_test",
    WORKOS_API_KEY: "sk_test",
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  } as unknown as Env;
}

function refreshRequest(refreshToken: unknown): Request {
  return new Request("https://api.test/api/v1/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("refresh token exchange", () => {
  it("returns the rotated token pair in the field names the CLI reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        user: { email: "person@acme.test" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyWorkosAuth(
      refreshRequest("stored-refresh"),
      environment(),
      "refresh",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: "client_test",
      client_secret: "sk_test",
      grant_type: "refresh_token",
      refresh_token: "stored-refresh",
    });
  });

  it("reports a revoked or superseded refresh token as invalid_grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 })),
    );

    const response = await proxyWorkosAuth(
      refreshRequest("stale-refresh"),
      environment(),
      "refresh",
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
  });

  it("rejects a WorkOS response without both tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ access_token: "rotated-access" })),
    );

    const response = await proxyWorkosAuth(
      refreshRequest("stored-refresh"),
      environment(),
      "refresh",
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "upstream_error" });
  });

  it("reports a WorkOS outage as upstream_error so the CLI retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "internal" }, { status: 503 })),
    );

    const response = await proxyWorkosAuth(
      refreshRequest("stored-refresh"),
      environment(),
      "refresh",
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "upstream_error" });
  });

  it("reports a missing WORKOS_API_KEY as a server misconfiguration", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyWorkosAuth(
      refreshRequest("stored-refresh"),
      environment({ WORKOS_API_KEY: undefined }),
      "refresh",
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "server_misconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request without a refresh token", async () => {
    const response = await proxyWorkosAuth(refreshRequest(""), environment(), "refresh");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_request" });
  });
});
