import type * as Core from "@tunnel/core";

declare global {
  interface Env {
    readonly WORKOS_API_KEY?: string;
    readonly CLOUDFLARE_API_TOKEN?: string;
    readonly CLOUDFLARE_ZONE_ID?: string;
    readonly SESSION_SECRET?: string;
    readonly AUTH_SECRET?: string;
    readonly AUTH_MODE?: string;
    readonly DEV_AUTH_SECRET?: string;
    readonly POSTHOG_API_KEY?: string;
    readonly POSTHOG_HOST?: string;
    readonly MAX_PREVIEW_FILE_BYTES?: string;
    readonly MAX_PREVIEW_FILES?: string;
    readonly PREVIEW_TTL_SECONDS?: string;
  }
  namespace Cloudflare {
    interface Env {
      readonly WORKOS_API_KEY?: string;
      readonly CLOUDFLARE_API_TOKEN?: string;
      readonly CLOUDFLARE_ZONE_ID?: string;
      readonly SESSION_SECRET?: string;
      readonly AUTH_SECRET?: string;
      readonly AUTH_MODE?: string;
      readonly DEV_AUTH_SECRET?: string;
      readonly POSTHOG_API_KEY?: string;
      readonly POSTHOG_HOST?: string;
      readonly MAX_PREVIEW_FILE_BYTES?: string;
      readonly MAX_PREVIEW_FILES?: string;
      readonly PREVIEW_TTL_SECONDS?: string;
    }
  }
}

export type DashboardRegistryStub = Core.Bindings.RegistryStub;
export type DashboardTunnelStub = Core.Bindings.TunnelStub;
