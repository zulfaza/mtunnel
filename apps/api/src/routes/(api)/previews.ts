import { limitsForOrganization } from "../../access.js";
import { Effect } from "effect";
import { Previews, Schemas } from "@tunnel/core";
import { authenticateUser, authErrorResponse } from "../../auth/workos.js";
import type { Env } from "../../env.js";
import {
  hashAccessCode,
  isAccessCode,
  isPreviewVisibility,
  type PreviewVisibility,
} from "../../preview-access.js";
import { jsonError, jsonResponse } from "../../utils/json.js";
import { runCore } from "../../runtime.js";

interface PreviewFile {
  readonly path: string;
  readonly size: number;
  readonly contentType: string;
  readonly sha256: string;
}

interface PreviewRow {
  readonly id: string;
  readonly name: string;
  readonly total_bytes: number;
  readonly file_count: number;
  readonly created_at: number;
  readonly expires_at: number;
  readonly manifest: string;
  readonly visibility: string;
  readonly repo_host: string | null;
  readonly repo_org: string | null;
  readonly repo_name: string | null;
}

interface VisibilityInput {
  readonly visibility: PreviewVisibility;
  readonly accessCodeHash: string | null;
}

async function visibilityFromBody(
  body: Record<string, unknown>,
  authSecret: string | undefined,
): Promise<VisibilityInput | null> {
  const visibility = "visibility" in body ? body.visibility : "public";
  if (!isPreviewVisibility(visibility)) return null;
  const accessCode = "accessCode" in body ? body.accessCode : undefined;
  if (visibility === "code") {
    if (!isAccessCode(accessCode)) return null;
    if (authSecret === undefined) return null;
    return { visibility, accessCodeHash: await hashAccessCode(accessCode, authSecret) };
  }
  if (accessCode !== undefined) return null;
  return { visibility, accessCodeHash: null };
}

function validFile(value: unknown): value is PreviewFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (
    "path" in value &&
    typeof value.path === "string" &&
    Schemas.isPreviewPath(value.path) &&
    "size" in value &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    "contentType" in value &&
    typeof value.contentType === "string" &&
    value.contentType.length > 0 &&
    value.contentType.length <= 255 &&
    "sha256" in value &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sha256)
  );
}

function optionalText(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return value === undefined || value === null ? null : typeof value === "string" ? value : null;
}

function optionalPreviewMetadata(body: Record<string, unknown>): boolean {
  return ["repoHost", "repoOrg", "repoName"].every((key) => {
    const value = body[key];
    return (
      value === undefined || value === null || (typeof value === "string" && value.length <= 255)
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewResponse(row: PreviewRow, domain: string): Record<string, string | number | null> {
  let filePath: string | undefined;
  try {
    const files: unknown = JSON.parse(row.manifest);
    if (Array.isArray(files) && files.length === 1 && validFile(files[0])) filePath = files[0].path;
  } catch {
    filePath = undefined;
  }
  const urlPath =
    filePath === undefined
      ? `${row.id}/`
      : `${row.id}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  return {
    id: row.id,
    name: row.name,
    url: `https://${domain}/${urlPath}`,
    totalBytes: row.total_bytes,
    fileCount: row.file_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    visibility: row.visibility,
    repoHost: row.repo_host,
    repoOrg: row.repo_org,
    repoName: row.repo_name,
  };
}

async function deletePrefix(env: Env, id: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.PREVIEWS.list(
      cursor === undefined ? { prefix: `${id}/` } : { prefix: `${id}/`, cursor },
    );
    if (page.objects.length > 0)
      await env.PREVIEWS.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
}

export async function handlePreviewCreate(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_request");
  }
  if (
    !isRecord(body) ||
    !("name" in body) ||
    !("files" in body) ||
    typeof body.name !== "string" ||
    body.name === "" ||
    body.name.length > 255 ||
    !Array.isArray(body.files) ||
    !body.files.every(validFile) ||
    !optionalPreviewMetadata(body)
  )
    return jsonError(400, "bad_request");
  const visibilityInput = await visibilityFromBody(body, env.AUTH_SECRET);
  if (visibilityInput === null) return jsonError(400, "bad_request");
  const files = body.files;
  const paths = new Set(files.map((file) => file.path));
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const limits = await limitsForOrganization(env, auth.organizationId);
  const fileLimit = Number(env.MAX_PREVIEW_FILE_BYTES ?? limits.maximumPreviewFileBytes);
  const countLimit =
    env.MAX_PREVIEW_FILES === undefined
      ? limits.maximumPreviewFiles
      : Number(env.MAX_PREVIEW_FILES);
  if (
    !Number.isSafeInteger(totalBytes) ||
    files.some((file) => file.size > fileLimit) ||
    paths.size !== files.length ||
    (countLimit !== null && files.length > countLimit)
  )
    return jsonError(413, "preview_limit_exceeded");
  const current = await env.DOMAINS.prepare(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total_bytes), 0) AS total FROM previews WHERE organization_id = ? AND expires_at > ?",
  )
    .bind(auth.organizationId, Date.now())
    .first<{ count: number; total: number }>();
  if (
    (limits.maximumPreviews !== null && (current?.count ?? 0) >= limits.maximumPreviews) ||
    (limits.maximumPreviewBytes !== null &&
      (current?.total ?? 0) + totalBytes > limits.maximumPreviewBytes)
  )
    return jsonError(413, "preview_limit_exceeded");
  const now = Date.now();
  const expiresAt = now + Number(env.PREVIEW_TTL_SECONDS ?? limits.previewTTLSeconds) * 1000;
  const row: PreviewRow = {
    id: Previews.previewId(),
    name: body.name,
    manifest: JSON.stringify(files),
    total_bytes: totalBytes,
    file_count: files.length,
    created_at: now,
    expires_at: expiresAt,
    visibility: visibilityInput.visibility,
    repo_host: optionalText(body, "repoHost"),
    repo_org: optionalText(body, "repoOrg"),
    repo_name: optionalText(body, "repoName"),
  };
  const existing =
    row.repo_org !== null && row.repo_name !== null
      ? await env.DOMAINS.prepare(
          "SELECT id FROM previews WHERE organization_id = ? AND name = ? AND repo_host IS ? AND repo_org = ? AND repo_name = ? AND expires_at > ?",
        )
          .bind(auth.organizationId, row.name, row.repo_host, row.repo_org, row.repo_name, now)
          .first<{ id: string }>()
      : null;
  if (existing !== null) {
    await deletePrefix(env, existing.id);
    await env.DOMAINS.prepare(
      "UPDATE previews SET user_id = ?, manifest = ?, total_bytes = ?, file_count = ?, created_at = ?, expires_at = ?, visibility = ?, access_code_hash = ? WHERE id = ?",
    )
      .bind(
        auth.userId,
        row.manifest,
        row.total_bytes,
        row.file_count,
        row.created_at,
        row.expires_at,
        row.visibility,
        visibilityInput.accessCodeHash,
        existing.id,
      )
      .run();
    return jsonResponse(previewResponse({ ...row, id: existing.id }, env.PREVIEW_DOMAIN));
  }
  await env.DOMAINS.prepare(
    "INSERT INTO previews (id, organization_id, user_id, name, manifest, total_bytes, file_count, created_at, expires_at, visibility, access_code_hash, repo_host, repo_org, repo_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      row.id,
      auth.organizationId,
      auth.userId,
      row.name,
      row.manifest,
      row.total_bytes,
      row.file_count,
      row.created_at,
      row.expires_at,
      row.visibility,
      visibilityInput.accessCodeHash,
      row.repo_host,
      row.repo_org,
      row.repo_name,
    )
    .run();
  return jsonResponse(previewResponse(row, env.PREVIEW_DOMAIN), 201);
}

export async function handlePreviewUpdate(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("visibility" in body))
    return jsonError(400, "bad_request");
  const visibilityInput = await visibilityFromBody(body, env.AUTH_SECRET);
  if (visibilityInput === null) return jsonError(400, "bad_request");
  const updated = await env.DOMAINS.prepare(
    "UPDATE previews SET visibility = ?, access_code_hash = ? WHERE id = ? AND organization_id = ? AND expires_at > ? RETURNING id, name, manifest, total_bytes, file_count, created_at, expires_at, visibility, repo_host, repo_org, repo_name",
  )
    .bind(
      visibilityInput.visibility,
      visibilityInput.accessCodeHash,
      id,
      auth.organizationId,
      Date.now(),
    )
    .first<PreviewRow>();
  if (updated === null) return jsonError(404, "not_found");
  return jsonResponse(previewResponse(updated, env.PREVIEW_DOMAIN));
}

export async function handlePreviewUpload(
  request: Request,
  env: Env,
  id: string,
  path: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  const row = await env.DOMAINS.prepare(
    "SELECT manifest, expires_at FROM previews WHERE id = ? AND organization_id = ? AND user_id = ?",
  )
    .bind(id, auth.organizationId, auth.userId)
    .first<{ manifest: string; expires_at: number }>();
  if (row === null || row.expires_at <= Date.now()) return jsonError(404, "not_found");
  let files: PreviewFile[];
  try {
    const parsed: unknown = JSON.parse(row.manifest);
    if (!Array.isArray(parsed) || !parsed.every(validFile))
      return jsonError(500, "invalid_manifest");
    files = parsed;
  } catch {
    return jsonError(500, "invalid_manifest");
  }
  const file = files.find((entry) => entry.path === path);
  if (
    file === undefined ||
    request.body === null ||
    request.headers.get("content-length") !== String(file.size)
  )
    return jsonError(400, "bad_request");
  const exactSize = await Previews.putPreviewObject(
    env.PREVIEWS,
    `${id}/${path}`,
    request.body,
    file.size,
    file.contentType,
    file.sha256,
  );
  if (!exactSize) return jsonError(400, "bad_request");
  return new Response(null, { status: 204 });
}

export async function handlePreviewList(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  const result = await env.DOMAINS.prepare(
    "SELECT id, name, manifest, total_bytes, file_count, created_at, expires_at, visibility, repo_host, repo_org, repo_name FROM previews WHERE organization_id = ? AND expires_at > ? ORDER BY created_at DESC",
  )
    .bind(auth.organizationId, Date.now())
    .all<PreviewRow>();
  return jsonResponse({
    previews: result.results.map((row) => previewResponse(row, env.PREVIEW_DOMAIN)),
  });
}

export async function handlePreviewDelete(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  const row = await env.DOMAINS.prepare(
    "SELECT id, name, manifest, total_bytes, file_count, created_at, expires_at, visibility, repo_host, repo_org, repo_name FROM previews WHERE id = ? AND organization_id = ? AND user_id = ?",
  )
    .bind(id, auth.organizationId, auth.userId)
    .first<PreviewRow>();
  if (row === null) return jsonError(404, "not_found");
  await deletePrefix(env, id);
  await env.DOMAINS.prepare("DELETE FROM previews WHERE id = ?").bind(id).run();
  return jsonResponse(previewResponse(row, env.PREVIEW_DOMAIN));
}

export function previewUploadPath(
  pathname: string,
): { readonly id: string; readonly path: string } | null {
  const match = /^\/api\/v1\/previews\/([a-z2-7]{26})\/files\/(.+)$/u.exec(pathname);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  try {
    const path = decodeURIComponent(match[2]);
    return Schemas.isPreviewPath(path) ? { id: match[1], path } : null;
  } catch {
    return null;
  }
}

export function previewIDFromPath(pathname: string): string | null {
  const match = /^\/api\/v1\/previews\/([a-z2-7]{26})$/u.exec(pathname);
  return match?.[1] ?? null;
}

export async function cleanupExpiredPreviews(env: Env): Promise<void> {
  await runCore(
    env,
    Effect.gen(function* () {
      const previews = yield* Previews.Previews;
      yield* previews.cleanupExpired();
    }),
  );
}
