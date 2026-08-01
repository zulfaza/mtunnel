import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { Auth, Errors, Organizations, Workos } from "@tunnel/core";
import type { Schemas } from "@tunnel/core";
import { runCore } from "./runtime.js";

const SESSION_COOKIE = "mt_session";
const STATE_COOKIE = "mt_login_state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export interface DashboardSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly email: string;
  readonly organizationId?: string;
}

export interface DashboardUser {
  readonly userId: string;
  readonly organizationId: string;
  readonly session: DashboardSession;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const copied = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copied.set(encoded);
  return copied;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
    const decoded = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1)
      decoded[index] = binary.charCodeAt(index);
    return decoded;
  } catch {
    return null;
  }
}

function sessionSecret(): string {
  const secret = env.SESSION_SECRET;
  if (secret === undefined || secret.length < 32)
    throw new Error("SESSION_SECRET is not configured");
  return secret;
}

function sessionValue(value: unknown): DashboardSession | null {
  if (!isRecord(value)) return null;
  const accessToken = nonEmptyString(value.accessToken);
  const refreshToken = nonEmptyString(value.refreshToken);
  const email = typeof value.email === "string" ? value.email : null;
  if (accessToken === null || refreshToken === null || email === null) return null;
  const organizationId = nonEmptyString(value.organizationId);
  return organizationId === null
    ? { accessToken, refreshToken, email }
    : { accessToken, refreshToken, email, organizationId };
}

async function signedValue(session: DashboardSession): Promise<string> {
  const payload = base64Url(utf8(JSON.stringify(session)));
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, utf8(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function verifyValue(value: string): Promise<DashboardSession | null> {
  const separator = value.indexOf(".");
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const encodedSignature = value.slice(separator + 1);
  const signature = decodeBase64Url(encodedSignature);
  const bytes = decodeBase64Url(payload);
  if (signature === null || bytes === null) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify("HMAC", key, signature, utf8(payload));
  if (!valid) return null;
  try {
    return sessionValue(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export async function readSession(): Promise<DashboardSession | null> {
  const value = getCookie(SESSION_COOKIE);
  return value === undefined ? null : verifyValue(value);
}

export async function writeSession(session: DashboardSession): Promise<void> {
  setCookie(SESSION_COOKIE, await signedValue(session), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearSession(): void {
  deleteCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}

export function writeLoginState(state: string): void {
  setCookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
}

export function takeLoginState(): string | null {
  const state = getCookie(STATE_COOKIE);
  deleteCookie(STATE_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  return state ?? null;
}

function workosSession(value: unknown): DashboardSession | null {
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

async function authenticatedSession(session: DashboardSession): Promise<DashboardUser> {
  const authenticate = (candidate: DashboardSession) =>
    runCore(
      Effect.gen(function* () {
        const authentication = yield* Auth.Authentication;
        return yield* authentication.authenticate({
          bearer: candidate.accessToken,
          organizationId: candidate.organizationId ?? null,
        });
      }),
    );
  try {
    const user = await authenticate(session);
    return { ...user, session };
  } catch (error: unknown) {
    if (!(error instanceof Errors.UnauthorizedError)) throw error;
    const refreshed = await runCore(
      Effect.gen(function* () {
        const workos = yield* Workos.Workos;
        return yield* workos.authenticate({ kind: "refresh", refreshToken: session.refreshToken });
      }),
    );
    const body = await refreshed.json().catch((): null => null);
    if (!refreshed.ok) throw new Errors.UnauthorizedError({});
    const nextSession = workosSession(body);
    if (nextSession === null) throw new Errors.UnauthorizedError({});
    const withOrganization =
      session.organizationId === undefined
        ? nextSession
        : { ...nextSession, organizationId: session.organizationId };
    await writeSession(withOrganization);
    const user = await authenticate(withOrganization);
    return { ...user, session: withOrganization };
  }
}

export async function requireUser(): Promise<DashboardUser> {
  const session = await readSession();
  if (session === null) throw new Error("signed_out");
  return authenticatedSession(session);
}

export async function membership(
  userId: string,
  organizationId: string,
): Promise<Schemas.OrganizationMembershipView[]> {
  return runCore(
    Effect.gen(function* () {
      const organizations = yield* Organizations.Organizations;
      return [...(yield* organizations.listForUser(userId))];
    }),
  ).then((organizations) =>
    organizations.filter((organization) => organization.id === organizationId),
  );
}
