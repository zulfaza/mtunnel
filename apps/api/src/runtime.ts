import { Effect } from "effect";
import { AgentTokens, Auth, Config, Errors, Runtime, Workos } from "@tunnel/core";
import type { Env } from "./env.js";

type CoreRuntime = ReturnType<typeof Runtime.makeCoreRuntime>;

let cachedRuntime: CoreRuntime | undefined;
let cachedEnvironment: Env | undefined;

function runtimeFor(env: Env): CoreRuntime {
  if (cachedRuntime !== undefined && cachedEnvironment === env) return cachedRuntime;
  const registry = env.REGISTRY?.getByName("global") ?? {
    claimTunnel: async () => false,
    ownsTunnel: async () => false,
    organizationForTunnel: async () => null,
    acquireConnection: async () => false,
    releaseConnection: async () => undefined,
  };
  cachedRuntime = Runtime.makeCoreRuntime(
    {
      domains: env.DOMAINS,
      previews: env.PREVIEWS,
      registry: () => env.REGISTRY?.getByName("global") ?? registry,
      tunnels: (tunnelId) =>
        env.TUNNELS?.getByName(tunnelId) ?? {
          status: async () => ({ tunnelId, connected: false, pendingRequests: 0 }),
          corsEnabled: () => false,
        },
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
      ...(env.MAX_PREVIEW_FILE_BYTES === undefined
        ? {}
        : { maximumPreviewFileBytes: Number(env.MAX_PREVIEW_FILE_BYTES) }),
      ...(env.MAX_PREVIEW_FILES === undefined
        ? {}
        : { maximumPreviewFiles: Number(env.MAX_PREVIEW_FILES) }),
      ...(env.PREVIEW_TTL_SECONDS === undefined
        ? {}
        : { previewTtlSeconds: Number(env.PREVIEW_TTL_SECONDS) }),
    },
  );
  cachedEnvironment = env;
  return cachedRuntime;
}

export async function runCore<A, E>(
  env: Env,
  effect: Effect.Effect<A, E, Runtime.CoreServices>,
): Promise<A> {
  return runtimeFor(env).runPromise(effect);
}

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  return /^Bearer [^\s]+$/iu.test(value ?? "") ? (value?.slice(7) ?? null) : null;
}

export type UserAuth =
  | { readonly ok: true; readonly userId: string; readonly organizationId: string }
  | { readonly ok: false; readonly status: 401 | 403 | 429 | 503 };

export async function authenticateUser(request: Request, env: Env): Promise<UserAuth> {
  try {
    const currentUser = await runCore(
      env,
      Effect.gen(function* () {
        const authentication = yield* Auth.Authentication;
        return yield* authentication.authenticate({
          bearer: bearer(request),
          organizationId: request.headers.get("x-organization-id"),
        });
      }),
    );
    const limited = await env.API_RATE_LIMITER.limit({
      key: `${currentUser.userId}:${currentUser.organizationId}`,
    });
    if (!limited.success) return { ok: false, status: 429 };
    return { ok: true, userId: currentUser.userId, organizationId: currentUser.organizationId };
  } catch (error: unknown) {
    if (error instanceof Errors.UnauthorizedError) return { ok: false, status: 401 };
    if (error instanceof Errors.ForbiddenError) return { ok: false, status: 403 };
    return { ok: false, status: 503 };
  }
}

export async function workosForm(path: string, body: URLSearchParams, env: Env): Promise<Response> {
  return runCore(
    env,
    Effect.gen(function* () {
      const workos = yield* Workos.Workos;
      return yield* workos.form(path, body);
    }),
  );
}

export const mintAgentToken = AgentTokens.mint;
export const coreErrors = Errors;
export const coreConfig = Config;
