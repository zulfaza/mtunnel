import type { TunnelDO } from "./durable-objects/tunnel-do.js";

export interface Env {
  readonly TUNNELS: DurableObjectNamespace<TunnelDO>;
  readonly AUTH_SECRET: string;
  readonly TUNNEL_DOMAIN: string;
  readonly DEV_ROUTING: string;
  readonly REQUEST_TIMEOUT_MS?: string;
  readonly MAX_PENDING_REQUESTS?: string;
  readonly MAX_REQUEST_BYTES?: string;
  readonly MAX_RESPONSE_BYTES?: string;
  readonly HEARTBEAT_INTERVAL_MS?: string;
  readonly HEARTBEAT_TIMEOUT_MS?: string;
}
