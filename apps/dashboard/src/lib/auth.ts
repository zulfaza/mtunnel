const AUTH_STORAGE_KEY = "mtunnel.auth";
const PKCE_STORAGE_PREFIX = "mtunnel.pkce.";
const WORKOS_AUTHORIZE_URL = "https://api.workos.com/user_management/authorize";

const configuredApiBase = import.meta.env.VITE_API_BASE;
export const API_BASE =
  typeof configuredApiBase === "string" && configuredApiBase.trim() !== ""
    ? configuredApiBase.trim().replace(/\/$/u, "")
    : import.meta.env.DEV
      ? "http://localhost:8787"
      : "https://api.makarima.xyz";

export interface StoredAuth {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly email: string;
  readonly organizationId?: string;
}

export class AuthError extends Error {}

interface WorkosAuthResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly email: string;
  readonly organizationId?: string;
}

interface PendingLogin {
  readonly verifier: string;
  readonly state: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseStoredAuth(value: unknown): StoredAuth | null {
  if (!isRecord(value)) return null;
  const accessToken = nonEmptyString(value.accessToken);
  const refreshToken = nonEmptyString(value.refreshToken);
  if (accessToken === null || refreshToken === null) return null;
  const email = typeof value.email === "string" ? value.email : "";
  const organizationId = nonEmptyString(value.organizationId);
  return organizationId === null
    ? { accessToken, refreshToken, email }
    : { accessToken, refreshToken, email, organizationId };
}

function readStoredAuth(storage: Storage): StoredAuth | null {
  const raw = storage.getItem(AUTH_STORAGE_KEY);
  if (raw === null) return null;
  try {
    return parseStoredAuth(JSON.parse(raw));
  } catch {
    storage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

function saveAuth(auth: StoredAuth): void {
  window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function storedAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  const current = readStoredAuth(window.sessionStorage);
  if (current !== null) return current;

  // Migrate the previous localStorage format once, then keep credentials
  // scoped to the browser session so a later XSS cannot recover a persistent
  // refresh token from the user's profile.
  const legacy = readStoredAuth(window.localStorage);
  if (legacy === null) return null;
  saveAuth(legacy);
  return legacy;
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  clearPendingLogin();
}

function pendingLoginKey(state: string): string {
  return `${PKCE_STORAGE_PREFIX}${state}`;
}

function parsePendingLogin(value: unknown): PendingLogin | null {
  if (!isRecord(value)) return null;
  const verifier = nonEmptyString(value.verifier);
  const state = nonEmptyString(value.state);
  return verifier === null || state === null ? null : { verifier, state };
}

function clearPendingLogin(state?: string): void {
  if (typeof window === "undefined") return;
  if (state !== undefined) {
    window.sessionStorage.removeItem(pendingLoginKey(state));
    return;
  }
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key !== null && key.startsWith(PKCE_STORAGE_PREFIX)) window.sessionStorage.removeItem(key);
  }
}

export function cancelLogin(state?: string): void {
  clearPendingLogin(state);
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch((): null => null);
}

function workosError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const description = nonEmptyString(value.error_description);
  if (description !== null) return description;
  const message = nonEmptyString(value.message);
  return message;
}

function parseWorkosAuthResponse(value: unknown): WorkosAuthResponse | null {
  if (!isRecord(value)) return null;
  const accessToken = nonEmptyString(value.access_token);
  const refreshToken = nonEmptyString(value.refresh_token);
  if (accessToken === null || refreshToken === null) return null;
  const user = isRecord(value.user) ? value.user : null;
  const email = user === null || typeof user.email !== "string" ? "" : user.email;
  const organizationId = nonEmptyString(value.organization_id);
  return organizationId === null
    ? { accessToken, refreshToken, email }
    : { accessToken, refreshToken, email, organizationId };
}

async function workosClientId(): Promise<string> {
  const cached = window.sessionStorage.getItem("mtunnel.client-id");
  if (cached !== null && cached.trim() !== "") return cached;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/auth/client`, { credentials: "omit" });
  } catch {
    throw new AuthError("Could not reach the authentication service.");
  }
  const body = await responseBody(response);
  if (!response.ok || !isRecord(body) || typeof body.clientId !== "string" || body.clientId === "")
    throw new AuthError("Could not load auth configuration.");
  window.sessionStorage.setItem("mtunnel.client-id", body.clientId);
  return body.clientId;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function startLogin(screenHint: "sign-in" | "sign-up"): Promise<void> {
  const clientId = await workosClientId();
  const verifier = base64Url(window.crypto.getRandomValues(new Uint8Array(48)));
  const state = base64Url(window.crypto.getRandomValues(new Uint8Array(24)));
  const challenge = base64Url(
    new Uint8Array(
      await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  window.sessionStorage.setItem(
    pendingLoginKey(state),
    JSON.stringify({ verifier, state } satisfies PendingLogin),
  );
  const authorize = new URL(WORKOS_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set(
    "redirect_uri",
    new URL("/callback", window.location.origin).toString(),
  );
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("provider", "authkit");
  authorize.searchParams.set("screen_hint", screenHint);
  window.location.assign(authorize.toString());
}

export async function completeLogin(code: string, state: string): Promise<void> {
  const key = pendingLoginKey(state);
  const raw = window.sessionStorage.getItem(key);
  window.sessionStorage.removeItem(key);
  if (raw === null) throw new AuthError("Login session expired. Start again.");

  let pending: PendingLogin | null;
  try {
    pending = parsePendingLogin(JSON.parse(raw));
  } catch {
    pending = null;
  }
  if (pending === null) throw new AuthError("Login session expired. Start again.");
  if (pending.state !== state) throw new AuthError("Login state mismatch. Start again.");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/auth/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        code,
        codeVerifier: pending.verifier,
      }),
    });
  } catch {
    throw new AuthError("Could not reach WorkOS. Start again.");
  }
  const body = await responseBody(response);
  if (!response.ok) throw new AuthError(workosError(body) ?? "Sign in failed. Start again.");
  const auth = parseWorkosAuthResponse(body);
  if (auth === null) throw new AuthError("Sign in failed. WorkOS returned an invalid session.");
  saveAuth(auth);
}

async function refreshAuthRequest(auth: StoredAuth): Promise<StoredAuth | null> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
  } catch {
    return null;
  }
  const body = await responseBody(response);
  if (!response.ok) return null;
  const refreshed = parseWorkosAuthResponse(body);
  if (refreshed === null) return null;
  return auth.organizationId === undefined
    ? {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        email: auth.email,
      }
    : {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        email: auth.email,
        organizationId: auth.organizationId,
      };
}

let refreshInFlight: Promise<StoredAuth | null> | null = null;

function refreshAuth(auth: StoredAuth): Promise<StoredAuth | null> {
  if (refreshInFlight !== null) return refreshInFlight;
  const request = refreshAuthRequest(auth);
  const tracked = request.finally(() => {
    if (refreshInFlight === tracked) refreshInFlight = null;
  });
  refreshInFlight = tracked;
  return tracked.then((updated) => {
    if (updated !== null) saveAuth(updated);
    return updated;
  });
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let auth = storedAuth();
  if (auth === null) throw new AuthError("Not signed in.");
  const attempt = (session: StoredAuth, token: string): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (session.organizationId !== undefined)
      headers.set("x-organization-id", session.organizationId);
    return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "omit" });
  };
  let response = await attempt(auth, auth.accessToken);
  if (response.status !== 401) return response;
  auth = await refreshAuth(auth);
  if (auth === null) {
    clearAuth();
    throw new AuthError("Session expired. Sign in again.");
  }
  return attempt(auth, auth.accessToken);
}
