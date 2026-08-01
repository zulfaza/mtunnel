import { timingSafeSecretEqual } from "./auth/index.js";

export type PreviewVisibility = "public" | "private" | "code";

export const ACCESS_CODE_MINIMUM_LENGTH = 4;
export const ACCESS_CODE_MAXIMUM_LENGTH = 128;

const encoder = new TextEncoder();

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return hex(new Uint8Array(digest));
}

export async function hashAccessCode(code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoded = encoder.encode(code);
  const payload = new Uint8Array(salt.length + encoded.length);
  payload.set(salt);
  payload.set(encoded, salt.length);
  return `${hex(salt)}:${await sha256Hex(payload)}`;
}

export async function verifyAccessCode(code: string, storedHash: string): Promise<boolean> {
  const separator = storedHash.indexOf(":");
  if (separator <= 0) return false;
  const saltHex = storedHash.slice(0, separator);
  const expected = storedHash.slice(separator + 1);
  if (saltHex.length % 2 !== 0 || !/^[a-f0-9]+$/u.test(saltHex)) return false;
  const salt = Uint8Array.from(saltHex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
  const encoded = encoder.encode(code);
  const payload = new Uint8Array(salt.length + encoded.length);
  payload.set(salt);
  payload.set(encoded, salt.length);
  return timingSafeSecretEqual(await sha256Hex(payload), expected);
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
