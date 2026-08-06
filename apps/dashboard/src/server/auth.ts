import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { decodeJwt } from "jose";
import { Organizations, Workos } from "@tunnel/core";
import { workosRedirectUri } from "../lib/workos-redirect.js";
import { runCore } from "./runtime.js";
import {
  clearSession,
  readSession,
  requireUser,
  takeLoginState,
  writeLoginState,
  writeSession,
} from "./session.js";

function randomValue(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const beginLogin = createServerFn({ method: "GET" })
  .validator((data: { readonly screenHint: "sign-in" | "sign-up" }) => data)
  .handler(async ({ data }: { readonly data: { readonly screenHint: "sign-in" | "sign-up" } }) => {
    const state = randomValue(24);
    const codeVerifier = randomValue(32);
    writeLoginState(state, codeVerifier);
    const codeChallenge = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(codeVerifier),
    );
    const target = new URL("https://api.workos.com/user_management/authorize");
    target.searchParams.set("client_id", env.WORKOS_CLIENT_ID);
    target.searchParams.set("redirect_uri", workosRedirectUri(getRequestUrl()));
    target.searchParams.set("response_type", "code");
    target.searchParams.set("provider", "authkit");
    target.searchParams.set("screen_hint", data.screenHint);
    target.searchParams.set("state", state);
    target.searchParams.set("code_challenge", randomValueFromBytes(new Uint8Array(codeChallenge)));
    target.searchParams.set("code_challenge_method", "S256");
    return { url: target.toString() };
  });

export const completeLogin = createServerFn({ method: "POST" })
  .validator((data: { readonly code: string; readonly state: string }) => data)
  .handler(
    async ({ data }: { readonly data: { readonly code: string; readonly state: string } }) => {
      const loginState = takeLoginState();
      if (loginState === null || loginState.state !== data.state)
        throw new Error("invalid_login_state");
      const response = await runCore(
        Effect.gen(function* () {
          const workos = yield* Workos.Workos;
          return yield* workos.authenticate({
            kind: "authorization-code",
            code: data.code,
            codeVerifier: loginState.codeVerifier,
          });
        }),
      );
      const body = await response.json().catch((): null => null);
      if (!response.ok) throw new Error(workosError(body) ?? "sign_in_failed");
      const session = parseSession(body);
      if (session === null) throw new Error("invalid_workos_session");
      await writeSession(session);
      return { email: session.email };
    },
  );

export const currentUser = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return { email: user.session.email, organizationId: user.organizationId };
});

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const session = await readSession().catch((): null => null);
  clearSession();
  const sessionId = session === null ? null : workosSessionId(session.accessToken);
  if (sessionId !== null) {
    try {
      await runCore(
        Effect.gen(function* () {
          const workos = yield* Workos.Workos;
          yield* workos.revokeSession(sessionId);
        }),
      );
    } catch {
      // Local session is already cleared; WorkOS revocation is best effort.
    }
  }
  return { ok: true };
});

function randomValueFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function workosSessionId(accessToken: string): string | null {
  try {
    const sessionId = decodeJwt(accessToken).sid;
    return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  } catch {
    return null;
  }
}

export const listOrganizations = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return runCore(
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return yield* organizations.listForUser(user.userId);
    }),
  );
});

export const createOrganization = createServerFn({ method: "POST" })
  .validator((data: { readonly name: string }) => data)
  .handler(async ({ data }: { readonly data: { readonly name: string } }) => {
    const name = data.name.trim();
    if (name.length === 0) throw new Error("organization_name_required");
    const user = await requireUser();
    return runCore(
      Effect.gen(function* () {
        const organizations = yield* Organizations.Organizations;
        return yield* organizations.createForUser(user.userId, name);
      }),
    );
  });

export const selectOrganization = createServerFn({ method: "POST" })
  .validator((data: { readonly organizationId: string }) => data)
  .handler(async ({ data }: { readonly data: { readonly organizationId: string } }) => {
    const organizationId = data.organizationId.trim();
    if (organizationId.length === 0) throw new Error("organization_required");
    const current = await requireUser();
    const allowed = await runCore(
      Effect.gen(function* () {
        const organizations = yield* Organizations.Organizations;
        return yield* organizations.forMember(current.userId, organizationId);
      }),
    );
    if (allowed === null) throw new Error("organization_forbidden");
    const session = await readSession();
    if (session === null) throw new Error("signed_out");
    await writeSession({ ...session, organizationId });
    return { organizationId };
  });

function workosError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return nonEmptyString(value.error_description) ?? nonEmptyString(value.message);
}

function parseSession(value: unknown) {
  if (!isRecord(value)) return null;
  const accessToken = nonEmptyString(value.access_token);
  const refreshToken = nonEmptyString(value.refresh_token);
  const user = isRecord(value.user) ? value.user : null;
  const email = user !== null && typeof user.email === "string" ? user.email : "";
  const organizationId = nonEmptyString(value.organization_id);
  if (accessToken === null || refreshToken === null) return null;
  return organizationId === null
    ? { accessToken, refreshToken, email }
    : { accessToken, refreshToken, email, organizationId };
}
