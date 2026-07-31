import type { Env } from "../../env.js";
import { siteNotFound } from "../(web)/site.js";

function headers(contentType: string | undefined, etag: string): Headers {
  const output = new Headers({
    "x-content-type-options": "nosniff",
    "cache-control": "public, max-age=60",
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

function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      new Map([
        ["&", "&amp;"],
        ["<", "&lt;"],
        [">", "&gt;"],
        ['"', "&quot;"],
        ["'", "&#39;"],
      ]).get(character) ?? character,
  );
}

async function listing(env: Env, id: string): Promise<Response> {
  const listed = await env.PREVIEWS.list({ prefix: `${id}/` });
  const entries = listed.objects.map((object) => object.key.slice(id.length + 1)).sort();
  const items = entries
    .map((entry) => `<li><a href="${encodeURI(entry)}">${escapeHTML(entry)}</a></li>`)
    .join("");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Preview files</title><h1>Preview files</h1><ul>${items}</ul>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=60",
      },
    },
  );
}

export async function servePreview(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return siteNotFound();
  const match = /^\/([a-z2-7]{26})(?:\/(.*))?$/u.exec(url.pathname);
  if (match?.[1] === undefined) return siteNotFound();
  const id = match[1];
  const preview = await env.DOMAINS.prepare("SELECT expires_at FROM previews WHERE id = ?")
    .bind(id)
    .first<{ expires_at: number }>();
  if (preview === null || preview.expires_at <= Date.now()) return siteNotFound();
  const path = match[2] ?? "";
  if (path === "") {
    const index = await env.PREVIEWS.get(`${id}/index.html`);
    if (index === null) return listing(env, id);
    return new Response(request.method === "HEAD" ? null : index.body, {
      headers: headers(index.httpMetadata?.contentType, index.httpEtag),
    });
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
  const range = requestedRange(request.headers.get("range"));
  const object = await env.PREVIEWS.get(
    `${id}/${decoded}`,
    range === undefined ? undefined : { range },
  );
  if (object === null) return siteNotFound();
  const responseHeaders = headers(object.httpMetadata?.contentType, object.httpEtag);
  if (object.range !== undefined && "offset" in object.range && object.range.length !== undefined) {
    responseHeaders.set(
      "content-range",
      `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`,
    );
    responseHeaders.set("content-length", String(object.range.length));
  } else responseHeaders.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: object.range === undefined ? 200 : 206,
    headers: responseHeaders,
  });
}
