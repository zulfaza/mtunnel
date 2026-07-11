import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: { setupFiles: ["./test/setup.ts"], fileParallelism: false },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          AUTH_SECRET: "development-token",
          AUTH_MODE: "development",
          WORKOS_CLIENT_ID: "client_test",
          TUNNEL_DOMAIN: "worker.test",
          DEV_ROUTING: "true",
          REQUEST_TIMEOUT_MS: "100",
          MAX_PENDING_REQUESTS: "2",
        },
      },
    }),
  ],
});
