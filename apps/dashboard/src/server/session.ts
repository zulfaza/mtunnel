import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { Auth, Errors, Organizations, Workos } from "@tunnel/core";
import type { Schemas } from "@tunnel/core";
import { runCore } from "./runtime.js";

const SESSION_COOKIE = "mt_session";
const STATE_COOKIE = "mt_login_state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const SESSION_VERSION = "v1";

export interface DashboardSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly email: string;
  readonly organizationId?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

type SessionCredentials = Omit<DashboardSession, "issuedAt" | "expiresAt">;

export interface DashboardUser {
  readonly userId: string;
  readonly organizationId: string;
  readonly session: DashboardSession;
}

export class SignedOutError extends Error {
  readonly _tag = "SignedOutError";

  constructor() {
    super("signed_out");
    this.name = "SignedOutError";
  }
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

const encryptionKeys = new Map<string, Promise<CryptoKey>>();

function sessionKey(): Promise<CryptoKey> {
  const secret = sessionSecret();
  const existing = encryptionKeys.get(secret);
  if (existing !== undefined) return existing;
  const key = crypto.subtle
    .digest("SHA-256", utf8(secret))
    .then((digest) =>
      crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
    );
  encryptionKeys.set(secret, key);
  return key;
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
  const issuedAt = value.issuedAt;
  const expiresAt = value.expiresAt;
  const now = Date.now();
  if (
    typeof issuedAt !== "number" ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt <= issuedAt
  )
    return null;
  return organizationId === null
    ? { accessToken, refreshToken, email, issuedAt, expiresAt }
    : { accessToken, refreshToken, email, organizationId, issuedAt, expiresAt };
}

async function encryptedValue(session: DashboardSession): Promise<string> {
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await sessionKey(),
    utf8(JSON.stringify(session)),
  );
  return `${SESSION_VERSION}.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function verifyValue(value: string): Promise<DashboardSession | null> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;
  const iv = decodeBase64Url(parts[1] ?? "");
  const ciphertext = decodeBase64Url(parts[2] ?? "");
  if (iv === null || ciphertext === null || iv.byteLength !== 12) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await sessionKey(),
      ciphertext,
    );
    return sessionValue(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    return null;
  }
}

export async function readSession(): Promise<DashboardSession | null> {
  const value = getCookie(SESSION_COOKIE);
  return value === undefined ? null : verifyValue(value);
}

export async function writeSession(session: SessionCredentials): Promise<void> {
  const persisted = sessionWithLifetime(session);
  setCookie(SESSION_COOKIE, await encryptedValue(persisted), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function sessionWithLifetime(session: SessionCredentials): DashboardSession {
  const issuedAt = Date.now();
  return {
    ...session,
    issuedAt,
    expiresAt: issuedAt + COOKIE_MAX_AGE * 1000,
  };
}

export function clearSession(): void {
  deleteCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}

export function writeLoginState(state: string, codeVerifier: string): void {
  setCookie(STATE_COOKIE, `${state}.${codeVerifier}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
}

export function takeLoginState(): { readonly state: string; readonly codeVerifier: string } | null {
  const state = getCookie(STATE_COOKIE);
  deleteCookie(STATE_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  if (state === undefined) return null;
  const parts = state.split(".");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== ""
    ? { state: parts[0] ?? "", codeVerifier: parts[1] ?? "" }
    : null;
}

function workosSession(value: unknown): SessionCredentials | null {
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
    const persisted = sessionWithLifetime(withOrganization);
    await writeSession(persisted);
    const user = await authenticate(persisted);
    return { ...user, session: persisted };
  }
}

export async function requireUser(): Promise<DashboardUser> {
  const session = await readSession();
  if (session === null) throw new SignedOutError();
  try {
    return await authenticatedSession(session);
  } catch (cause) {
    if (!(cause instanceof Errors.UnauthorizedError)) throw cause;
    clearSession();
    throw new SignedOutError();
  }
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
