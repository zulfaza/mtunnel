import type { Env } from "../../env.js";
import { Previews } from "@tunnel/core";
import {
  DOCUMENT_ACCESS_GRANT_TTL_MS,
  PREVIEW_ACCESS_SESSION_COOKIE,
  accessCodeFingerprint,
  accessSessionHash,
  accessSessionToken,
  cookieValue,
  verifyAccessCode,
  verifyPreviewOwnerTicket,
} from "../../preview-access.js";
import { errorPage, previewCodePage } from "../(web)/pages.js";
import { siteNotFound } from "../(web)/site.js";

function headers(contentType: string | undefined, etag: string, cacheControl: string): Headers {
  const output = new Headers({
    "x-content-type-options": "nosniff",
    "cache-control": cacheControl,
    etag,
  });
  if (contentType !== undefined) output.set("content-type", contentType);
  return output;
}

function requestedRange(value: string | null): R2Range | undefined {
  if (value === null) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const offset = Number(match[1]);
  const end = match[2] === "" ? undefined : Number(match[2]);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (end !== undefined && (!Number.isSafeInteger(end) || end < offset))
  )
    return undefined;
  return end === undefined ? { offset } : { offset, length: end - offset + 1 };
}

interface PreviewAccessRow {
  readonly organization_id: string;
  readonly user_id: string;
  readonly name: string;
  readonly expires_at: number;
  readonly visibility: string;
  readonly document_id: string | null;
  readonly manifest: string;
}

interface AccessCodeRow {
  readonly id: string;
  readonly code_hash: string;
}

function previewPaths(manifest: string): readonly string[] | null {
  let value: unknown;
  try {
    value = JSON.parse(manifest);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const paths = value.flatMap((file): readonly string[] => {
    if (typeof file !== "object" || file === null || !("path" in file)) return [];
    return typeof file.path === "string" ? [file.path] : [];
  });
  return paths.length === value.length ? paths : null;
}

async function sessionCredential(
  request: Request,
  secret: string,
): Promise<{ readonly token: string; readonly hash: string }> {
  const existing = cookieValue(request.headers.get("cookie"), PREVIEW_ACCESS_SESSION_COOKIE);
  if (existing !== null) {
    const hash = await accessSessionHash(existing, secret);
    if (hash !== null) return { token: existing, hash };
  }
  const token = accessSessionToken();
  const hash = await accessSessionHash(token, secret);
  if (hash === null) throw new Error("generated invalid preview access session");
  return { token, hash };
}

async function redeemAccessCode(
  env: Env,
  documentId: string,
  submitted: string,
  sessionHash: string,
  now: number,
): Promise<string | null> {
  const secret = env.AUTH_SECRET;
  if (secret === undefined) return null;
  const fingerprint = await accessCodeFingerprint(submitted, secret);
  const candidates = await env.DOMAINS.prepare(
    "SELECT id, code_hash FROM preview_access_codes WHERE document_id = ? AND used_at IS NULL AND (code_fingerprint = ? OR code_fingerprint IS NULL) ORDER BY created_at DESC LIMIT 100",
  )
    .bind(documentId, fingerprint)
    .all<AccessCodeRow>();
  for (const candidate of candidates.results) {
    if (!(await verifyAccessCode(submitted, candidate.code_hash, secret))) continue;
    const redeemed = await env.DOMAINS.prepare(
      "UPDATE preview_access_codes SET used_at = ?, used_by_session_hash = ? WHERE id = ? AND used_at IS NULL",
    )
      .bind(now, sessionHash, candidate.id)
      .run();
    return redeemed.meta.changes === 1 ? candidate.id : null;
  }
  return null;
}

function accessCookie(token: string): string {
  return `${PREVIEW_ACCESS_SESSION_COOKIE}=${token}; Path=/; Max-Age=${String(Math.floor(DOCUMENT_ACCESS_GRANT_TTL_MS / 1000))}; HttpOnly; Secure; SameSite=Lax`;
}

function accessRedirect(location: string, sessionToken?: string): Response {
  const outputHeaders = new Headers({
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  if (sessionToken !== undefined) outputHeaders.set("set-cookie", accessCookie(sessionToken));
  return new Response(null, { status: 303, headers: outputHeaders });
}

async function grantDocumentAccess(
  env: Env,
  documentId: string,
  sessionHash: string,
  now: number,
): Promise<void> {
  await env.DOMAINS.prepare(
    "INSERT INTO preview_access_grants (session_hash, document_id, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_hash, document_id) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at",
  )
    .bind(sessionHash, documentId, now, now + DOCUMENT_ACCESS_GRANT_TTL_MS)
    .run();
}

async function handleCodeSubmission(
  request: Request,
  env: Env,
  id: string,
  documentId: string,
  url: URL,
  submittedCode?: string,
): Promise<Response> {
  if (env.AUTH_SECRET === undefined)
    return errorPage(503, "server_misconfigured", "This preview cannot verify access codes.");
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const limited = await env.PREVIEW_RATE_LIMITER.limit({ key: `${clientIp}:${id}` });
  if (!limited.success) return errorPage(429, "rate_limited", "Too many access attempts.");
  let submitted = submittedCode ?? "";
  if (submittedCode === undefined) {
    try {
      const form = await request.formData();
      const field = form.get("code");
      if (typeof field === "string") submitted = field;
    } catch {
      return previewCodePage(true);
    }
  }
  const session = await sessionCredential(request, env.AUTH_SECRET);
  const now = Date.now();
  const redeemedCodeId =
    submitted === "" ? null : await redeemAccessCode(env, documentId, submitted, session.hash, now);
  if (redeemedCodeId === null)
    return submittedCode === undefined
      ? previewCodePage(true)
      : accessRedirect(`${url.origin}${url.pathname}?access=invalid`);
  try {
    await grantDocumentAccess(env, documentId, session.hash, now);
  } catch (error: unknown) {
    await env.DOMAINS.prepare(
      "UPDATE preview_access_codes SET used_at = NULL, used_by_session_hash = NULL WHERE id = ? AND used_by_session_hash = ? AND used_at = ?",
    )
      .bind(redeemedCodeId, session.hash, now)
      .run();
    throw error;
  }
  return accessRedirect(`${url.origin}${url.pathname}`, session.token);
}

async function handleOwnerTicket(
  request: Request,
  env: Env,
  preview: PreviewAccessRow,
  id: string,
  documentId: string,
  url: URL,
): Promise<Response> {
  const ticket = url.searchParams.get("owner_ticket");
  if (ticket === null || env.AUTH_SECRET === undefined)
    return accessRedirect(`${url.origin}${url.pathname}?owner=denied`);
  const payload = await verifyPreviewOwnerTicket(env.AUTH_SECRET, ticket, id);
  if (payload === null || payload.userId !== preview.user_id)
    return accessRedirect(`${url.origin}${url.pathname}?owner=denied`);
  const session = await sessionCredential(request, env.AUTH_SECRET);
  await grantDocumentAccess(env, documentId, session.hash, Date.now());
  return accessRedirect(`${url.origin}${url.pathname}`, session.token);
}

async function hasDocumentAccess(request: Request, env: Env, documentId: string): Promise<boolean> {
  if (env.AUTH_SECRET === undefined) return false;
  const token = cookieValue(request.headers.get("cookie"), PREVIEW_ACCESS_SESSION_COOKIE);
  if (token === null) return false;
  const hash = await accessSessionHash(token, env.AUTH_SECRET);
  if (hash === null) return false;
  const grant = await env.DOMAINS.prepare(
    "SELECT 1 AS allowed FROM preview_access_grants WHERE session_hash = ? AND document_id = ? AND expires_at > ?",
  )
    .bind(hash, documentId, Date.now())
    .first<{ allowed: number }>();
  return grant?.allowed === 1;
}

export async function servePreview(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
    return siteNotFound();
  }
  if (url.pathname === "/" || url.pathname === "") {
    return Response.redirect(`https://app.${env.TUNNEL_DOMAIN}/`, 302);
  }
  const match = /^\/([a-z2-7]{26})(?:\/(.*))?$/u.exec(url.pathname);
  if (match?.[1] === undefined) return siteNotFound();
  const id = match[1];
  const preview = await env.DOMAINS.prepare(
    "SELECT organization_id, user_id, name, expires_at, visibility, document_id, manifest FROM previews WHERE id = ?",
  )
    .bind(id)
    .first<PreviewAccessRow>();
  if (preview === null || preview.expires_at <= Date.now()) return siteNotFound();
  let cacheControl = "public, max-age=60";
  if (preview.visibility === "private")
    return errorPage(403, "preview_private", "This preview is private.");
  if (preview.visibility === "code") {
    cacheControl = "private, no-store";
    const documentId = preview.document_id ?? id;
    if (url.searchParams.has("owner_ticket"))
      return handleOwnerTicket(request, env, preview, id, documentId, url);
    const allowed = await hasDocumentAccess(request, env, documentId);
    if (allowed) {
      if (request.method === "POST") return siteNotFound();
      if (url.searchParams.has("code") || url.searchParams.has("access"))
        return accessRedirect(`${url.origin}${url.pathname}`);
    } else {
      if (request.method === "POST") return handleCodeSubmission(request, env, id, documentId, url);
      const submittedCode = request.method === "GET" ? url.searchParams.get("code") : null;
      if (submittedCode !== null)
        return handleCodeSubmission(request, env, id, documentId, url, submittedCode);
      if (request.method === "GET" && !url.searchParams.has("owner")) {
        const authorize = new URL(`https://app.${env.TUNNEL_DOMAIN}/preview-owner-access`);
        authorize.searchParams.set("return", `${url.origin}${url.pathname}`);
        return accessRedirect(authorize.toString());
      }
      return previewCodePage(url.searchParams.get("access") === "invalid");
    }
  } else if (request.method === "POST") return siteNotFound();
  const paths = previewPaths(preview.manifest);
  if (paths === null) return siteNotFound();
  let path = match[2];
  if (path === undefined || path === "") {
    path = paths.includes("index.html") ? "index.html" : paths.length === 1 ? paths[0] : undefined;
    if (path === undefined) return siteNotFound();
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return siteNotFound();
  }
  if (
    decoded === "" ||
    decoded.startsWith("/") ||
    decoded.includes("\\") ||
    decoded.split("/").includes("..")
  )
    return siteNotFound();
  if (!paths.includes(decoded)) return siteNotFound();
  const range = requestedRange(request.headers.get("range"));
  const getOptions = range === undefined ? undefined : { range };
  const key = Previews.previewObjectKey(preview.organization_id, preview.name, id);
  const object =
    (await env.PREVIEWS.get(key, getOptions)) ??
    (await env.PREVIEWS.get(`${key}/${decoded}`, getOptions)) ??
    (await env.PREVIEWS.get(`${id}/${decoded}`, getOptions));
  if (object === null) return siteNotFound();
  const responseHeaders = headers(object.httpMetadata?.contentType, object.httpEtag, cacheControl);
  if (
    range !== undefined &&
    object.range !== undefined &&
    "offset" in object.range &&
    object.range.length !== undefined
  ) {
    responseHeaders.set(
      "content-range",
      `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`,
    );
    responseHeaders.set("content-length", String(object.range.length));
  } else responseHeaders.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: range === undefined ? 200 : 206,
    headers: responseHeaders,
  });
}
