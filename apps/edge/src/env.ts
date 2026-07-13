import type { TunnelDO } from "./durable-objects/tunnel-do.js";
import type { RegistryDO } from "./durable-objects/registry-do.js";

export interface Env {
  readonly ASSETS: Fetcher;
  readonly TUNNELS: DurableObjectNamespace<TunnelDO>;
  readonly REGISTRY: DurableObjectNamespace<RegistryDO>;
  readonly DOMAINS: D1Database;
  readonly AUTH_RATE_LIMITER: RateLimit;
  readonly AUTH_SECRET?: string;
  readonly AUTH_MODE?: string;
  readonly DEV_AUTH_SECRET?: string;
  readonly WORKOS_CLIENT_ID: string;
  readonly WORKOS_API_KEY?: string;
  readonly WORKOS_ISSUER?: string;
  readonly CLOUDFLARE_API_TOKEN?: string;
  readonly CLOUDFLARE_ZONE_ID?: string;
  readonly TUNNEL_DOMAIN: string;
  readonly CUSTOM_DOMAIN_CNAME: string;
  readonly DEV_ROUTING: string;
  readonly REQUEST_TIMEOUT_MS?: string;
  readonly MAX_PENDING_REQUESTS?: string;
  readonly MAX_REQUEST_BYTES?: string;
  readonly MAX_RESPONSE_BYTES?: string;
  readonly HEARTBEAT_INTERVAL_MS?: string;
  readonly HEARTBEAT_TIMEOUT_MS?: string;
  readonly POSTHOG_API_KEY?: string;
  readonly POSTHOG_HOST?: string;
}
