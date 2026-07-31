import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyWorkosAccessToken } from "../src/auth/workos.js";

async function signedAccessToken(claims: {
  readonly clientId: string;
  readonly issuer: string;
  readonly subject?: string;
}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const token = await new SignJWT({ client_id: claims.clientId })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(claims.issuer)
    .setSubject(claims.subject ?? "user_01TEST")
    .setExpirationTime("5m")
    .sign(privateKey);
  return {
    token,
    jwks: createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", kid: "test-key" }] }),
  };
}

describe("WorkOS access tokens", () => {
  it("accepts a token issued for the configured application", async () => {
    const signed = await signedAccessToken({
      clientId: "client_production",
      issuer: "https://api.workos.com/user_management/client_production",
    });

    await expect(
      verifyWorkosAccessToken(signed.token, { WORKOS_CLIENT_ID: "client_production" }, signed.jwks),
    ).resolves.toBe("user_01TEST");
  });

  it("rejects a token issued for another application", async () => {
    const signed = await signedAccessToken({
      clientId: "client_other",
      issuer: "https://api.workos.com/user_management/client_other",
    });

    await expect(
      verifyWorkosAccessToken(signed.token, { WORKOS_CLIENT_ID: "client_production" }, signed.jwks),
    ).resolves.toBeNull();
  });

  it("rejects a token from an unexpected issuer", async () => {
    const signed = await signedAccessToken({
      clientId: "client_production",
      issuer: "https://example.com/",
    });

    await expect(
      verifyWorkosAccessToken(signed.token, { WORKOS_CLIENT_ID: "client_production" }, signed.jwks),
    ).resolves.toBeNull();
  });
});
