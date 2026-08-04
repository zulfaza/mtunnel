import { timingSafeSecretEqual } from "../../auth/index.js";
import type { Env } from "../../env.js";
import {
  cookieValue,
  previewAccessCookieName,
  previewAccessCookieValue,
  verifyAccessCode,
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
  readonly expires_at: number;
  readonly visibility: string;
  readonly access_code_hash: string | null;
}

async function handleCodeSubmission(
  request: Request,
  env: Env,
  id: string,
  preview: PreviewAccessRow,
  url: URL,
): Promise<Response> {
  if (env.AUTH_SECRET === undefined || preview.access_code_hash === null)
    return errorPage(503, "server_misconfigured", "This preview cannot verify access codes.");
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const limited = await env.PREVIEW_RATE_LIMITER.limit({ key: `${clientIp}:${id}` });
  if (!limited.success) return errorPage(429, "rate_limited", "Too many access attempts.");
  let submitted = "";
  try {
    const form = await request.formData();
    const field = form.get("code");
    if (typeof field === "string") submitted = field;
  } catch {
    return previewCodePage(true);
  }
  if (
    submitted === "" ||
    !(await verifyAccessCode(submitted, preview.access_code_hash, env.AUTH_SECRET))
  )
    return previewCodePage(true);
  const cookie = await previewAccessCookieValue(env.AUTH_SECRET, id, preview.access_code_hash);
  const maxAge = Math.max(1, Math.floor((preview.expires_at - Date.now()) / 1000));
  return new Response(null, {
    status: 303,
    headers: {
      location: url.pathname,
      "set-cookie": `${previewAccessCookieName(id)}=${cookie}; Path=/${id}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

async function hasCodeAccess(
  request: Request,
  env: Env,
  id: string,
  preview: PreviewAccessRow,
): Promise<boolean> {
  if (env.AUTH_SECRET === undefined || preview.access_code_hash === null) return false;
  const provided = cookieValue(request.headers.get("cookie"), previewAccessCookieName(id));
  if (provided === null) return false;
  const expected = await previewAccessCookieValue(env.AUTH_SECRET, id, preview.access_code_hash);
  return timingSafeSecretEqual(provided, expected);
}

export async function servePreview(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST")
    return siteNotFound();
  if (url.pathname === "/" || url.pathname === "")
    return Response.redirect(`https://app.${env.TUNNEL_DOMAIN}/`, 302);
  const match = /^\/([a-z2-7]{26})(?:\/(.*))?$/u.exec(url.pathname);
  if (match?.[1] === undefined) return siteNotFound();
  if (match[2] === undefined || match[2] === "")
    return Response.redirect(`https://app.${env.TUNNEL_DOMAIN}/`, 302);
  const id = match[1];
  const preview = await env.DOMAINS.prepare(
    "SELECT expires_at, visibility, access_code_hash FROM previews WHERE id = ?",
  )
    .bind(id)
    .first<PreviewAccessRow>();
  if (preview === null || preview.expires_at <= Date.now()) return siteNotFound();
  let cacheControl = "public, max-age=60";
  if (preview.visibility === "private")
    return errorPage(403, "preview_private", "This preview is private.");
  if (preview.visibility === "code") {
    cacheControl = "private, no-store";
    if (request.method === "POST") return handleCodeSubmission(request, env, id, preview, url);
    if (!(await hasCodeAccess(request, env, id, preview))) return previewCodePage(false);
  } else if (request.method === "POST") return siteNotFound();
  const path = match[2];
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
  const range = requestedRange(request.headers.get("range"));
  const object = await env.PREVIEWS.get(
    `${id}/${decoded}`,
    range === undefined ? undefined : { range },
  );
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
