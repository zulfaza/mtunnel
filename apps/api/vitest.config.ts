import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: { setupFiles: ["./test/setup.ts"], fileParallelism: false },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          AUTH_SECRET: "signing-secret",
          AUTH_MODE: "development",
          DEV_AUTH_SECRET: "development-token",
          WORKOS_CLIENT_ID: "client_test",
          TUNNEL_DOMAIN: "worker.test",
          PREVIEW_DOMAIN: "preview.worker.test",
          CUSTOM_DOMAIN_CNAME: "cname.worker.test",
          DEV_ROUTING: "true",
          REQUEST_TIMEOUT_MS: "100",
          MAX_PENDING_REQUESTS: "2",
        },
      },
    }),
  ],
});
