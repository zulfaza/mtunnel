import { Context, Data, Effect, Layer } from "effect";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { CoreConfig } from "./config.js";

export class WorkosRequestError extends Data.TaggedError("WorkosRequestError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type WorkosGrant =
  | { readonly kind: "device" }
  | { readonly kind: "device-token"; readonly deviceCode: string }
  | { readonly kind: "refresh"; readonly refreshToken: string }
  | {
      readonly kind: "authorization-code";
      readonly code: string;
      readonly codeVerifier?: string;
      readonly ipAddress?: string;
      readonly userAgent?: string;
    };

const jwksByClientId = new Map<string, JWTVerifyGetKey>();

function jwksForClient(clientId: string): JWTVerifyGetKey {
  const existing = jwksByClientId.get(clientId);
  if (existing !== undefined) return existing;
  const jwks = createRemoteJWKSet(
    new URL(`https://api.workos.com/sso/jwks/${encodeURIComponent(clientId)}`),
  );
  jwksByClientId.set(clientId, jwks);
  return jwks;
}

export async function verifyWorkosAccessToken(
  token: string,
  clientId: string,
  jwks: JWTVerifyGetKey = jwksForClient(clientId),
): Promise<string | null> {
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: `https://api.workos.com/user_management/${clientId}`,
    });
    if (result.payload.client_id !== clientId || typeof result.payload.sub !== "string")
      return null;
    return result.payload.sub;
  } catch {
    return null;
  }
}

export class Workos extends Context.Service<
  Workos,
  {
    readonly verifyAccessToken: (token: string) => Effect.Effect<string | null>;
    readonly request: (
      path: string,
      init?: RequestInit,
      allowNotFound?: boolean,
    ) => Effect.Effect<unknown, WorkosRequestError>;
    readonly form: (path: string, params: URLSearchParams) => Effect.Effect<Response>;
    readonly authenticate: (grant: WorkosGrant) => Effect.Effect<Response, WorkosRequestError>;
    readonly revokeSession: (sessionId: string) => Effect.Effect<void, WorkosRequestError>;
  }
>()("@tunnel/core/auth/Workos") {}

export const workosLayer = Layer.effect(
  Workos,
  Effect.gen(function* () {
    const config = yield* CoreConfig;
    const verifyAccessToken = Effect.fn("workos.verify_access_token")(function* (token: string) {
      return yield* Effect.promise(() => verifyWorkosAccessToken(token, config.workosClientId));
    });
    const request = Effect.fn("workos.request")(function* (
      path: string,
      init?: RequestInit,
      allowNotFound = false,
    ) {
      if (config.workosApiKey === undefined)
        return yield* Effect.fail(
          new WorkosRequestError({ message: "WORKOS_API_KEY is not configured" }),
        );
      const response = yield* Effect.tryPromise({
        try: async () => {
          const headers = new Headers(init?.headers);
          headers.set("authorization", `Bearer ${config.workosApiKey}`);
          if (init?.body !== undefined) headers.set("content-type", "application/json");
          return fetch(`https://api.workos.com${path}`, { ...init, headers });
        },
        catch: (cause) => new WorkosRequestError({ message: "WorkOS request failed", cause }),
      });
      const value = yield* Effect.promise(() => response.json().catch((): null => null));
      if (allowNotFound && response.status === 404) return null;
      if (!response.ok)
        return yield* Effect.fail(
          new WorkosRequestError({
            message: `WorkOS request failed with status ${response.status}`,
          }),
        );
      return value;
    });
    const form = Effect.fn("workos.form")(function* (path: string, params: URLSearchParams) {
      return yield* Effect.promise(() =>
        fetch(`https://api.workos.com/user_management/${path}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: params,
        }),
      );
    });
    const authenticate = Effect.fn("workos.authenticate")(function* (grant: WorkosGrant) {
      const body = new URLSearchParams({ client_id: config.workosClientId });
      if (grant.kind === "device") return yield* form("authorize/device", body);
      if (grant.kind === "device-token") {
        body.set("device_code", grant.deviceCode);
        body.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
        return yield* form("authenticate", body);
      }
      if (config.workosApiKey === undefined)
        return yield* Effect.fail(
          new WorkosRequestError({ message: "WORKOS_API_KEY is not configured" }),
        );
      const payload =
        grant.kind === "refresh"
          ? {
              client_id: config.workosClientId,
              client_secret: config.workosApiKey,
              grant_type: "refresh_token",
              refresh_token: grant.refreshToken,
            }
          : {
              client_id: config.workosClientId,
              client_secret: config.workosApiKey,
              grant_type: "authorization_code",
              code: grant.code,
              ...(grant.codeVerifier === undefined ? {} : { code_verifier: grant.codeVerifier }),
              ...(grant.ipAddress === undefined ? {} : { ip_address: grant.ipAddress }),
              ...(grant.userAgent === undefined ? {} : { user_agent: grant.userAgent }),
            };
      return yield* Effect.promise(() =>
        fetch("https://api.workos.com/user_management/authenticate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
    });
    const revokeSession = Effect.fn("workos.revoke_session")(function* (sessionId: string) {
      if (config.workosApiKey === undefined)
        return yield* Effect.fail(
          new WorkosRequestError({ message: "WORKOS_API_KEY is not configured" }),
        );
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch("https://api.workos.com/user_management/sessions/revoke", {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.workosApiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ session_id: sessionId }),
          }),
        catch: (cause) => new WorkosRequestError({ message: "WorkOS request failed", cause }),
      });
      if (!response.ok)
        return yield* Effect.fail(
          new WorkosRequestError({
            message: `WorkOS request failed with status ${response.status}`,
          }),
        );
    });
    return Workos.of({ verifyAccessToken, request, form, authenticate, revokeSession });
  }),
);
