import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
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
