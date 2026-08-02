import { env } from "cloudflare:workers";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { Runtime, Schemas } from "@tunnel/core";
import type { Bindings } from "@tunnel/core";

type CoreRuntime = ReturnType<typeof Runtime.makeCoreRuntime>;

let cachedRuntime: CoreRuntime | undefined;
let cachedEnvironment: typeof env | undefined;

const decodeTunnelStatus = Schema.decodeUnknownSync(Schemas.TunnelStatusView);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function method(value: unknown, name: string): (...argumentsList: readonly unknown[]) => unknown {
  if (!isRecord(value)) throw new Error(`RPC method ${name} is unavailable`);
  const candidate = value[name];
  if (typeof candidate !== "function") throw new Error(`RPC method ${name} is unavailable`);
  return (...argumentsList) => Reflect.apply(candidate, value, argumentsList);
}

function registryStub(value: unknown): Bindings.RegistryStub {
  const claimTunnel = method(value, "claimTunnel");
  const ownsTunnel = method(value, "ownsTunnel");
  const organizationForTunnel = method(value, "organizationForTunnel");
  const acquireConnection = method(value, "acquireConnection");
  const releaseConnection = method(value, "releaseConnection");
  return {
    claimTunnel: async (tunnelId, organizationId, legacyUserId) =>
      (await claimTunnel(tunnelId, organizationId, legacyUserId)) === true,
    ownsTunnel: async (tunnelId, organizationId, legacyUserId) =>
      (await ownsTunnel(tunnelId, organizationId, legacyUserId)) === true,
    organizationForTunnel: async (tunnelId) => {
      const result = await organizationForTunnel(tunnelId);
      return typeof result === "string" ? result : null;
    },
    acquireConnection: async (tunnelId, organizationId, connectionId, maximum) =>
      (await acquireConnection(tunnelId, organizationId, connectionId, maximum)) === true,
    releaseConnection: async (tunnelId, organizationId, connectionId) => {
      await releaseConnection(tunnelId, organizationId, connectionId);
    },
  };
}

function tunnelStub(value: unknown): Bindings.TunnelStub {
  const status = method(value, "status");
  const corsEnabled = method(value, "corsEnabled");
  return {
    status: async (tunnelId) => decodeTunnelStatus(await status(tunnelId)),
    corsEnabled: async () => (await corsEnabled()) === true,
  };
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runtimeFor(): CoreRuntime {
  if (cachedRuntime !== undefined && cachedEnvironment === env) return cachedRuntime;
  const maximumPreviewFileBytes = numberValue(env.MAX_PREVIEW_FILE_BYTES);
  const maximumPreviewFiles = numberValue(env.MAX_PREVIEW_FILES);
  const previewTtlSeconds = numberValue(env.PREVIEW_TTL_SECONDS);
  cachedRuntime = Runtime.makeCoreRuntime(
    {
      domains: env.DOMAINS,
      previews: env.PREVIEWS,
      registry: () => registryStub(env.REGISTRY.getByName("global")),
      tunnels: (tunnelId) => tunnelStub(env.TUNNELS.getByName(tunnelId)),
    },
    {
      tunnelDomain: env.TUNNEL_DOMAIN,
      previewDomain: env.PREVIEW_DOMAIN,
      customDomainCname: env.CUSTOM_DOMAIN_CNAME,
      workosClientId: env.WORKOS_CLIENT_ID,
      ...(env.WORKOS_API_KEY === undefined ? {} : { workosApiKey: env.WORKOS_API_KEY }),
      ...(env.CLOUDFLARE_API_TOKEN === undefined
        ? {}
        : { cloudflareApiToken: env.CLOUDFLARE_API_TOKEN }),
      ...(env.CLOUDFLARE_ZONE_ID === undefined ? {} : { cloudflareZoneId: env.CLOUDFLARE_ZONE_ID }),
      ...(env.AUTH_SECRET === undefined ? {} : { authSecret: env.AUTH_SECRET }),
      ...(env.AUTH_MODE === undefined ? {} : { authMode: env.AUTH_MODE }),
      ...(env.DEV_AUTH_SECRET === undefined ? {} : { devAuthSecret: env.DEV_AUTH_SECRET }),
      ...(env.POSTHOG_API_KEY === undefined ? {} : { posthogApiKey: env.POSTHOG_API_KEY }),
      ...(env.POSTHOG_HOST === undefined ? {} : { posthogHost: env.POSTHOG_HOST }),
      ...(maximumPreviewFileBytes === undefined ? {} : { maximumPreviewFileBytes }),
      ...(maximumPreviewFiles === undefined ? {} : { maximumPreviewFiles }),
      ...(previewTtlSeconds === undefined ? {} : { previewTtlSeconds }),
    },
  );
  cachedEnvironment = env;
  return cachedRuntime;
}

export function runCore<A, E>(effect: Effect.Effect<A, E, Runtime.CoreServices>): Promise<A> {
  return runtimeFor().runPromise(effect);
}
