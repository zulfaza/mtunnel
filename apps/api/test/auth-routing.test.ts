import { describe, expect, it } from "vitest";
import { mintAgentToken, mintSignedToken, verifyAgentToken } from "../src/auth/index.js";
import { tunnelIdFromDevPath, tunnelIdFromHost } from "../src/routing/index.js";

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
});
