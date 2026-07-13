import { authenticateUser, authErrorResponse } from "../../auth/workos.js";
import type { Env } from "../../env.js";
import { jsonError, jsonResponse } from "../../utils/json.js";

const maximumUploadBytes = 5 * 1024 * 1024;
const maximumMultipartOverheadBytes = 64 * 1024;

function acceptsPreviewType(type: string): boolean {
  return type === "text/html" || type.startsWith("image/");
}

function validFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    filename.length <= 255 &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    !filename.includes("\u0000")
  );
}

interface PreviewLocation {
  readonly organizationId: string;
  readonly userId: string;
  readonly name: string;
}

type PreviewVisibility = "organization" | "public";

function objectKey(location: PreviewLocation): string {
  return `${location.organizationId}/${location.userId}/${location.name}`;
}

function urlForPreview(request: Request, location: PreviewLocation): string {
  return new URL(
    `/api/v1/previews/${encodeURIComponent(location.organizationId)}/${encodeURIComponent(location.userId)}/${encodeURIComponent(location.name)}`,
    request.url,
  ).toString();
}

function uploadName(filename: string): string {
  return `${new Date().toISOString().slice(0, 10)}-${filename}`;
}

function fileFromForm(value: File | string | null): File | null {
  return value instanceof File ? value : null;
}

function validIdentifier(value: string): boolean {
  return (
    value.length > 0 && !value.includes("/") && !value.includes("\\") && !value.includes("\u0000")
  );
}

function visibilityFromForm(value: File | string | null): PreviewVisibility | null {
  if (value === null || value === "organization") return "organization";
  return value === "public" ? "public" : null;
}

function visibilityFromJson(value: unknown): PreviewVisibility | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("visibility" in value)
  )
    return null;
  return value.visibility === "organization" || value.visibility === "public"
    ? value.visibility
    : null;
}

export function previewLocation(pathname: string): PreviewLocation | null {
  const match = /^\/api\/v1\/previews\/([^/]+)\/([^/]+)\/([^/]+)$/u.exec(pathname);
  const organizationId = match?.[1];
  const userId = match?.[2];
  const name = match?.[3];
  if (
    organizationId === undefined ||
    userId === undefined ||
    name === undefined ||
    !validIdentifier(organizationId) ||
    !validIdentifier(userId) ||
    !validFilename(name)
  )
    return null;
  return { organizationId, userId, name };
}

export async function handlePreviewUpload(request: Request, env: Env): Promise<Response> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    Number(contentLength) > maximumUploadBytes + maximumMultipartOverheadBytes
  )
    return jsonError(413, "payload_too_large");
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "bad_request");
  }
  const file = fileFromForm(form.get("file"));
  const visibility = visibilityFromForm(form.get("visibility"));
  if (file === null || !validFilename(file.name) || !acceptsPreviewType(file.type))
    return jsonError(400, "bad_request");
  if (visibility === null) return jsonError(400, "bad_request");
  if (file.size > maximumUploadBytes) return jsonError(413, "payload_too_large");
  const name = uploadName(file.name);
  const location = { organizationId: auth.organizationId, userId: auth.userId, name };
  const key = objectKey(location);
  await env.PREVIEWS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { visibility },
  });
  return jsonResponse(
    {
      key,
      url: urlForPreview(request, location),
      visibility,
    },
    201,
  );
}

async function authorizePreviewOrganization(
  request: Request,
  env: Env,
  location: PreviewLocation,
): Promise<Response | null> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  return auth.organizationId === location.organizationId ? null : jsonError(403, "forbidden");
}

export async function handlePreviewList(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  const prefix = `${auth.organizationId}/`;
  const previews: Array<{
    readonly key: string;
    readonly url: string;
    readonly visibility: string;
    readonly size: number;
    readonly uploadedAt: string;
  }> = [];
  let cursor: string | undefined;
  do {
    const page =
      cursor === undefined
        ? await env.PREVIEWS.list({ prefix })
        : await env.PREVIEWS.list({ prefix, cursor });
    for (const object of page.objects) {
      const location = previewLocation(`/api/v1/previews/${object.key}`);
      if (location === null) continue;
      previews.push({
        key: object.key,
        url: urlForPreview(request, location),
        visibility: object.customMetadata?.visibility ?? "organization",
        size: object.size,
        uploadedAt: object.uploaded.toISOString(),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return jsonResponse({ previews });
}

export async function handlePreviewGet(
  request: Request,
  env: Env,
  location: PreviewLocation,
): Promise<Response> {
  const object = await env.PREVIEWS.get(objectKey(location));
  if (object === null) return jsonError(404, "not_found");
  if (object.customMetadata?.visibility !== "public") {
    const auth = await authenticateUser(request, env);
    if (!auth.ok) return authErrorResponse(auth);
    if (auth.organizationId !== location.organizationId) return jsonError(403, "forbidden");
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

export async function handlePreviewVisibilityUpdate(
  request: Request,
  env: Env,
  location: PreviewLocation,
): Promise<Response> {
  const authorization = await authorizePreviewOrganization(request, env, location);
  if (authorization !== null) return authorization;
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return jsonError(400, "bad_request");
  }
  const visibility = visibilityFromJson(value);
  if (visibility === null) return jsonError(400, "bad_request");
  const key = objectKey(location);
  const object = await env.PREVIEWS.get(key);
  if (object === null) return jsonError(404, "not_found");
  const contentType = object.httpMetadata?.contentType;
  await env.PREVIEWS.put(key, object.body, {
    ...(contentType === undefined ? {} : { httpMetadata: { contentType } }),
    customMetadata: { visibility },
  });
  return jsonResponse({ key, url: urlForPreview(request, location), visibility });
}

export async function handlePreviewDelete(
  request: Request,
  env: Env,
  location: PreviewLocation,
): Promise<Response> {
  const authorization = await authorizePreviewOrganization(request, env, location);
  if (authorization !== null) return authorization;
  const key = objectKey(location);
  const object = await env.PREVIEWS.head(key);
  if (object === null) return jsonError(404, "not_found");
  await env.PREVIEWS.delete(key);
  return new Response(null, { status: 204 });
}
