import { TOKEN_TTL_SECONDS } from "@tunnel/config";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface AgentClaims {
  readonly sub: string;
  readonly tunnelId: string;
  readonly purpose: "agent";
  readonly iat: number;
  readonly exp: number;
}

export interface SignedClaims {
  readonly sub: string;
  readonly tunnelId: string;
  readonly purpose: string;
  readonly iat: number;
  readonly exp: number;
}

export type VerifyTokenResult =
  | { readonly ok: true; readonly claims: AgentClaims }
  | {
      readonly ok: false;
      readonly reason:
        | "bad_structure"
        | "bad_signature"
        | "expired"
        | "tunnel_mismatch"
        | "bad_purpose";
    };

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded =
      value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(rootSecret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(rootSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signature(value: string, rootSecret: string): Promise<Uint8Array> {
  const signed = await crypto.subtle.sign("HMAC", await hmacKey(rootSecret), encoder.encode(value));
  return new Uint8Array(signed);
}

export async function mintAgentToken(
  rootSecret: string,
  tunnelId: string,
  sub: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ readonly token: string; readonly claims: AgentClaims }> {
  const claims: AgentClaims = {
    sub,
    tunnelId,
    purpose: "agent",
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  return { token: await mintSignedToken(rootSecret, claims), claims };
}

/** Internal-friendly primitive used by tests and token issuers with validated claims. */
export async function mintSignedToken(rootSecret: string, claims: SignedClaims): Promise<string> {
  const claimsPart = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  return `${claimsPart}.${encodeBase64Url(await signature(claimsPart, rootSecret))}`;
}

function parseClaims(value: Uint8Array): AgentClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(value));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.sub !== "string" ||
    typeof record.tunnelId !== "string" ||
    typeof record.iat !== "number" ||
    !Number.isFinite(record.iat) ||
    typeof record.exp !== "number" ||
    !Number.isFinite(record.exp) ||
    typeof record.purpose !== "string"
  ) {
    return null;
  }
  return {
    sub: record.sub,
    tunnelId: record.tunnelId,
    iat: record.iat,
    exp: record.exp,
    purpose: record.purpose as "agent",
  };
}

export async function verifyAgentToken(
  token: string,
  rootSecret: string,
  expectedTunnelId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyTokenResult> {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return { ok: false, reason: "bad_structure" };
  }
  const claimsPart = parts[0];
  const signaturePart = parts[1];
  if (claimsPart === undefined || signaturePart === undefined) {
    return { ok: false, reason: "bad_structure" };
  }
  const claimsBytes = decodeBase64Url(claimsPart);
  const signatureBytes = decodeBase64Url(signaturePart);
  if (claimsBytes === null || signatureBytes === null)
    return { ok: false, reason: "bad_structure" };
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(rootSecret),
    signatureBytes,
    encoder.encode(claimsPart),
  );
  if (!valid) return { ok: false, reason: "bad_signature" };
  const claims = parseClaims(claimsBytes);
  if (claims === null) return { ok: false, reason: "bad_structure" };
  if (claims.exp <= nowSeconds) return { ok: false, reason: "expired" };
  if (claims.tunnelId !== expectedTunnelId) return { ok: false, reason: "tunnel_mismatch" };
  if (claims.purpose !== "agent") return { ok: false, reason: "bad_purpose" };
  return { ok: true, claims };
}

export function timingSafeSecretEqual(provided: string, expected: string): boolean {
  const providedBytes = encoder.encode(provided);
  const expectedBytes = encoder.encode(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  return crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);
}
