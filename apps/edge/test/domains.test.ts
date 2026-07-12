import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addDomain } from "../src/domains.js";

const PENDING_DOMAIN_TTL_MS = 72 * 60 * 60 * 1000;

async function insertPendingDomain(hostname: string, createdAt: number): Promise<void> {
  await env.DOMAINS.prepare(
    `INSERT INTO custom_domains
       (hostname, tunnel_id, organization_id, verification_token, status, created_at, updated_at)
     VALUES (?, 'tunnel-a', 'org-a', 'token-a', 'pending_dns', ?, ?)`,
  )
    .bind(hostname, createdAt, createdAt)
    .run();
}

describe("addDomain squatting expiry", () => {
  it("reclaims a hostname stuck in pending_dns past the TTL", async () => {
    await insertPendingDomain("stale.test", Date.now() - PENDING_DOMAIN_TTL_MS - 1000);

    const result = await addDomain(env, {
      hostname: "stale.test",
      tunnelId: "tunnel-b",
      organizationId: "org-b",
      userId: "user-b",
      maximumDomains: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.domain.tunnelId).toBe("tunnel-b");
  });

  it("does not reclaim a hostname still within the TTL", async () => {
    await insertPendingDomain("fresh.test", Date.now());

    const result = await addDomain(env, {
      hostname: "fresh.test",
      tunnelId: "tunnel-b",
      organizationId: "org-b",
      userId: "user-b",
      maximumDomains: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("domain_or_tunnel_taken");
  });
});
