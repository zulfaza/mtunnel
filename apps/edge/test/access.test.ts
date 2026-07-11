import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { limitsForOrganization } from "../src/access.js";

describe("organization access", () => {
  it("restricts organizations by default", async () => {
    await expect(limitsForOrganization(env, "org_restricted")).resolves.toEqual({
      maximumCustomDomains: 1,
      maximumActiveTunnels: 3,
      idleTimeoutSeconds: 900,
      maximumTunnelLifetimeSeconds: 3600,
    });
  });

  it("opens every limit for marked organizations", async () => {
    await env.DOMAINS.prepare(
      "INSERT INTO organization_access (organization_id, unrestricted, updated_at) VALUES (?, 1, ?)",
    )
      .bind("org_unrestricted", Date.now())
      .run();

    await expect(limitsForOrganization(env, "org_unrestricted")).resolves.toEqual({
      maximumCustomDomains: null,
      maximumActiveTunnels: null,
      idleTimeoutSeconds: 0,
      maximumTunnelLifetimeSeconds: 0,
    });
  });
});
