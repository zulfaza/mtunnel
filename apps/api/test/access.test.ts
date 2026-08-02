import { env } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";
import { limitsForOrganization } from "../src/access.js";

describe("organization access", () => {
  it("restricts organizations by default", async () => {
    await expect(limitsForOrganization(env, "org_restricted")).resolves.toEqual({
      maximumCustomDomains: 1,
      maximumActiveTunnels: 3,
      idleTimeoutSeconds: 900,
      maximumTunnelLifetimeSeconds: 3600,
      maximumPreviews: 20,
      maximumPreviewBytes: 2 * 1024 * 1024 * 1024,
      maximumPreviewFileBytes: 100 * 1024 * 1024,
      maximumPreviewFiles: 500,
      previewTTLSeconds: 7 * 24 * 60 * 60,
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
      maximumPreviews: null,
      maximumPreviewBytes: null,
      maximumPreviewFileBytes: 100 * 1024 * 1024,
      maximumPreviewFiles: null,
      previewTTLSeconds: 30 * 24 * 60 * 60,
    });
  });
});
