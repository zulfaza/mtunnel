import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DOMAINS, env.TEST_MIGRATIONS);
  await env.DOMAINS.prepare(
    "INSERT INTO organization_access (organization_id, unrestricted, updated_at) VALUES (?, 1, ?)",
  )
    .bind("development-organization", Date.now())
    .run();
});
