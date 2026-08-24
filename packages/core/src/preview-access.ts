import { timingSafeSecretEqual } from "./agent-tokens.js";
import { ACCESS_CODE_MINIMUM_LENGTH } from "./schemas.js";
import type { PreviewVisibility } from "./schemas.js";

export { ACCESS_CODE_MINIMUM_LENGTH };
export const ACCESS_CODE_MAXIMUM_LENGTH = 128;
export const DOCUMENT_ACCESS_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_ACCESS_SESSION_COOKIE = "preview_access_session";
export const PREVIEW_OWNER_TICKET_TTL_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();
const hmacKeys = new Map<string, Promise<CryptoKey>>();

export function isPreviewVisibility(value: unknown): value is PreviewVisibility {
  return value === "public" || value === "private" || value === "code";
}

export function isAccessCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= ACCESS_CODE_MINIMUM_LENGTH &&
    value.length <= ACCESS_CODE_MAXIMUM_LENGTH
  );
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  const existing = hmacKeys.get(secret);
  if (existing !== undefined) return existing;
  const key = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  hmacKeys.set(secret, key);
  return key;
}

async function hmacHex(secret: string, bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.sign("HMAC", await hmacKey(secret), bytes);
  return hex(new Uint8Array(digest));
}

export async function accessCodeFingerprint(code: string, secret: string): Promise<string> {
  return hmacHex(secret, encoder.encode(`preview-access-code:${code}`));
}

interface PreviewOwnerTicketPayload {
  readonly previewId: string;
  readonly userId: string;
  readonly expiresAt: number;
}

export async function previewOwnerTicket(
  secret: string,
  payload: PreviewOwnerTicketPayload,
): Promise<string> {
  const encoded = base64Url(JSON.stringify(payload));
  const signature = await hmacHex(secret, encoder.encode(`preview-owner-ticket:${encoded}`));
  return `${encoded}.${signature}`;
}

export async function verifyPreviewOwnerTicket(
  secret: string,
  ticket: string,
  previewId: string,
  now = Date.now(),
): Promise<PreviewOwnerTicketPayload | null> {
  const parts = ticket.split(".");
  const encoded = parts[0];
  const signature = parts[1];
  if (parts.length !== 2 || encoded === undefined || signature === undefined) return null;
  const expected = await hmacHex(secret, encoder.encode(`preview-owner-ticket:${encoded}`));
  if (!timingSafeSecretEqual(expected, signature)) return null;
  const decoded = decodeBase64Url(encoded);
  if (decoded === null) return null;
  try {
    const payload: unknown = JSON.parse(decoded);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("previewId" in payload) ||
      payload.previewId !== previewId ||
      !("userId" in payload) ||
      typeof payload.userId !== "string" ||
      payload.userId.length === 0 ||
      !("expiresAt" in payload) ||
      typeof payload.expiresAt !== "number" ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= now
    )
      return null;
    return { previewId, userId: payload.userId, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

export function accessSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function accessSessionHash(token: string, secret: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  return hmacHex(secret, encoder.encode(`preview-access-session:${token}`));
}

export async function hashAccessCode(code: string, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoded = encoder.encode(code);
  const payload = new Uint8Array(salt.length + encoded.length);
  payload.set(salt);
  payload.set(encoded, salt.length);
  return `v2:${hex(salt)}:${await hmacHex(secret, payload)}`;
}

export async function verifyAccessCode(
  code: string,
  storedHash: string,
  secret: string,
): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "v2") return false;
  const saltHex = parts[1] ?? "";
  const expected = parts[2] ?? "";
  if (saltHex.length % 2 !== 0 || !/^[a-f0-9]+$/u.test(saltHex)) return false;
  const salt = Uint8Array.from(saltHex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
  const encoded = encoder.encode(code);
  const payload = new Uint8Array(salt.length + encoded.length);
  payload.set(salt);
  payload.set(encoded, salt.length);
  return timingSafeSecretEqual(await hmacHex(secret, payload), expected);
}

export async function previewAccessCookieValue(
  secret: string,
  previewId: string,
  accessCodeHash: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`preview-access:${previewId}:${accessCodeHash}`),
  );
  return hex(new Uint8Array(signed));
}

export function previewAccessCookieName(previewId: string): string {
  return `preview_access_${previewId}`;
}

export function cookieValue(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}
