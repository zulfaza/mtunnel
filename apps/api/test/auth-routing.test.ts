import { describe, expect, it } from "vite-plus/test";
import { mintAgentToken, mintSignedToken, verifyAgentToken } from "../src/auth/index.js";
import { tunnelIdFromDevPath, tunnelIdFromHost } from "../src/routing/index.js";
import { organizationRoute } from "../src/routes/(api)/organizations.js";

describe("agent tokens", () => {
  it("mints and verifies a valid token", async () => {
    const minted = await mintAgentToken("secret", "demo-tunnel", "agent");
    await expect(verifyAgentToken(minted.token, "secret", "demo-tunnel")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("rejects an expired token", async () => {
    const minted = await mintAgentToken("secret", "demo-tunnel", "agent", 1);
    await expect(verifyAgentToken(minted.token, "secret", "demo-tunnel", 1_000)).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a token for another tunnel", async () => {
    const minted = await mintAgentToken("secret", "demo-tunnel", "agent");
    await expect(verifyAgentToken(minted.token, "secret", "other-tunnel")).resolves.toEqual({
      ok: false,
      reason: "tunnel_mismatch",
    });
  });

  it("rejects a token with the wrong purpose", async () => {
    const token = await mintSignedToken("secret", {
      sub: "agent",
      tunnelId: "demo-tunnel",
      purpose: "browser",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(verifyAgentToken(token, "secret", "demo-tunnel")).resolves.toEqual({
      ok: false,
      reason: "bad_purpose",
    });
  });
});

describe("routing", () => {
  it("parses valid tunnel hostnames", () => {
    expect(tunnelIdFromHost("demo-tunnel.tunnel.example.com:8787", "tunnel.example.com")).toBe(
      "demo-tunnel",
    );
  });

  it("rejects invalid ids and non-matching domains", () => {
    expect(tunnelIdFromHost("a.tunnel.example.com", "tunnel.example.com")).toBeNull();
    expect(tunnelIdFromHost("demo-tunnel.not-tunnel.example.com", "tunnel.example.com")).toBeNull();
  });

  it("rewrites dev paths", () => {
    expect(tunnelIdFromDevPath("/t/demo-tunnel/api/x")).toEqual({
      tunnelId: "demo-tunnel",
      rewrittenPath: "/api/x",
    });
    expect(tunnelIdFromDevPath("/t/demo-tunnel")).toEqual({
      tunnelId: "demo-tunnel",
      rewrittenPath: "/",
    });
  });

  it("parses organization management paths", () => {
    expect(organizationRoute("/api/v1/organizations/org_1")).toEqual({
      action: "detail",
      organizationId: "org_1",
    });
    expect(organizationRoute("/api/v1/organizations/org_1/invitations")).toEqual({
      action: "invitations",
      organizationId: "org_1",
    });
    expect(organizationRoute("/api/v1/organizations/org_1/membership")).toEqual({
      action: "membership",
      organizationId: "org_1",
    });
    expect(organizationRoute("/api/v1/organizations/org_1/members")).toEqual({
      action: "members",
      organizationId: "org_1",
    });
    expect(organizationRoute("/api/v1/organizations/org_1/members/om_2")).toEqual({
      action: "member",
      organizationId: "org_1",
      membershipId: "om_2",
    });
    expect(organizationRoute("/api/v1/organizations/org_1/unknown")).toBeNull();
  });
});
