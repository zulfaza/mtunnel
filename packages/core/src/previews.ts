import { Context, Effect, Layer, Schema } from "effect";
import { AccessLimits } from "./access.js";
import { DomainsDatabase, PreviewBucket } from "./bindings.js";
import { CoreConfig, type CoreConfigShape } from "./config.js";
import {
  BadRequestError,
  InvalidManifestError,
  NotFoundError,
  PreviewLimitError,
} from "./errors.js";
import {
  accessCodeFingerprint,
  hashAccessCode,
  isAccessCode,
  isPreviewVisibility,
} from "./preview-access.js";
import {
  PreviewCreateRequest,
  type PreviewAccessCodeView,
  type PreviewAccessSessionView,
  type PreviewAccessView,
  PreviewFile,
  PreviewView,
  type OrganizationLimits,
  type PreviewVisibility,
} from "./schemas.js";

interface PreviewRow {
  readonly id: string;
  readonly document_id: string;
  readonly name: string;
  readonly version: number;
  readonly total_bytes: number;
  readonly file_count: number;
  readonly created_at: number;
  readonly expires_at: number;
  readonly manifest: string;
  readonly visibility: string;
  readonly group_name: string | null;
  readonly repo_host: string | null;
  readonly repo_org: string | null;
  readonly repo_name: string | null;
}

interface PreviewCreateInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly request: unknown;
}

interface PreviewIdentity {
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
}

interface PreviewUploadInput extends PreviewIdentity {
  readonly path: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentLength: string | null;
}

interface PreviewAccessIdentity {
  readonly organizationId: string;
  readonly previewId: string;
}

interface PreviewDocumentIdentity {
  readonly organizationId: string;
  readonly documentId: string;
}

interface PreviewAccessItemIdentity extends PreviewAccessIdentity {
  readonly id: string;
}

const PreviewRowSchema = Schema.Struct({
  id: Schema.String,
  document_id: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  total_bytes: Schema.Number,
  file_count: Schema.Number,
  created_at: Schema.Number,
  expires_at: Schema.Number,
  manifest: Schema.String,
  visibility: Schema.String,
  group_name: Schema.NullOr(Schema.String),
  repo_host: Schema.NullOr(Schema.String),
  repo_org: Schema.NullOr(Schema.String),
  repo_name: Schema.NullOr(Schema.String),
});
const PreviewUploadRowSchema = Schema.Struct({
  manifest: Schema.String,
  expires_at: Schema.Number,
});
const decodePreviewRow = Schema.decodeUnknownOption(PreviewRowSchema);
const decodePreviewUploadRow = Schema.decodeUnknownOption(PreviewUploadRowSchema);
const decodeManifest = Schema.decodeUnknownOption(Schema.Array(PreviewFile));
const decodePreviewCreateRequest = Schema.decodeUnknownOption(PreviewCreateRequest);

export async function putPreviewObject(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream<Uint8Array>,
  size: number,
  contentType: string,
  sha256: string,
): Promise<boolean> {
  let bytes = 0;
  let exceeded = false;
  const countedBody = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        const previousBytes = bytes - chunk.byteLength;
        const remaining = Math.max(0, size - previousBytes);
        if (remaining < chunk.byteLength) exceeded = true;
        if (remaining > 0) controller.enqueue(chunk.slice(0, remaining));
      },
    }),
  );
  const fixedLength = new FixedLengthStream(size);
  const transfer = countedBody.pipeTo(fixedLength.writable, {
    preventAbort: true,
    preventCancel: true,
  });
  try {
    await bucket.put(key, fixedLength.readable, {
      httpMetadata: { contentType },
      sha256,
    });
    await transfer;
  } catch (error: unknown) {
    await transfer.catch(() => undefined);
    if (exceeded || bytes !== size) {
      await bucket.delete(key);
      return false;
    }
    throw error;
  }
  if (bytes === size) return true;
  await bucket.delete(key);
  return false;
}

export function previewId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let output = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31] ?? "";
  return output;
}

function response(row: PreviewRow, domain: string): PreviewView {
  return {
    id: row.id,
    documentId: row.document_id,
    name: row.name,
    version: row.version,
    url: `https://${domain}/${row.id}`,
    totalBytes: row.total_bytes,
    fileCount: row.file_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    visibility: isPreviewVisibility(row.visibility) ? row.visibility : "public",
    group: row.group_name,
    repoHost: row.repo_host,
    repoOrg: row.repo_org,
    repoName: row.repo_name,
  };
}

function parseManifest(value: string): readonly Schema.Schema.Type<typeof PreviewFile>[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const decoded = decodeManifest(parsed);
  return decoded._tag === "Some" ? decoded.value : null;
}

function limitsWithOverrides(
  limits: OrganizationLimits,
  config: CoreConfigShape,
): OrganizationLimits {
  return {
    ...limits,
    maximumPreviewFileBytes: config.maximumPreviewFileBytes ?? limits.maximumPreviewFileBytes,
    maximumPreviewFiles: config.maximumPreviewFiles ?? limits.maximumPreviewFiles,
    previewTTLSeconds: config.previewTtlSeconds ?? limits.previewTTLSeconds,
  };
}

export class Previews extends Context.Service<
  Previews,
  {
    readonly create: (
      input: PreviewCreateInput,
    ) => Effect.Effect<PreviewView, PreviewLimitError | BadRequestError>;
    readonly update: (
      input: PreviewIdentity & {
        readonly visibility: PreviewVisibility;
        readonly accessCode?: string;
      },
    ) => Effect.Effect<PreviewView, PreviewLimitError | BadRequestError | NotFoundError>;
    readonly upload: (
      input: PreviewUploadInput,
    ) => Effect.Effect<void, BadRequestError | InvalidManifestError | NotFoundError>;
    readonly list: (organizationId: string) => Effect.Effect<readonly PreviewView[]>;
    readonly versions: (
      input: PreviewDocumentIdentity,
    ) => Effect.Effect<readonly PreviewView[], NotFoundError>;
    readonly access: (
      input: PreviewAccessIdentity,
    ) => Effect.Effect<PreviewAccessView, NotFoundError>;
    readonly deleteAccessCode: (
      input: PreviewAccessItemIdentity,
    ) => Effect.Effect<void, NotFoundError>;
    readonly revokeAccessSession: (
      input: PreviewAccessItemIdentity,
    ) => Effect.Effect<void, NotFoundError>;
    readonly delete: (input: PreviewIdentity) => Effect.Effect<PreviewView, NotFoundError>;
    readonly cleanupExpired: () => Effect.Effect<void>;
    readonly findForServing: (id: string) => Effect.Effect<{
      readonly expiresAt: number;
      readonly visibility: string;
      readonly accessCodeHash: string | null;
    } | null>;
  }
>()("@tunnel/core/previews/Previews") {}

export const previewsLayer = Layer.effect(
  Previews,
  Effect.gen(function* () {
    const database = yield* DomainsDatabase;
    const bucket = yield* PreviewBucket;
    const access = yield* AccessLimits;
    const config = yield* CoreConfig;
    const deletePrefix = Effect.fn("previews.delete_prefix")(function* (id: string) {
      let cursor: string | undefined;
      do {
        const page = yield* Effect.promise(() =>
          bucket.list(cursor === undefined ? { prefix: `${id}/` } : { prefix: `${id}/`, cursor }),
        );
        if (page.objects.length > 0)
          yield* Effect.promise(() => bucket.delete(page.objects.map((object) => object.key)));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor !== undefined);
    });
    const visibilityHash = Effect.fn("previews.visibility_hash")(function* (
      visibility: PreviewVisibility | undefined,
      accessCode: string | undefined,
    ) {
      const value = visibility ?? "public";
      if (!isPreviewVisibility(value)) return yield* Effect.fail(new BadRequestError({}));
      if (value === "code") {
        if (!isAccessCode(accessCode)) return yield* Effect.fail(new BadRequestError({}));
        const authSecret = config.authSecret;
        if (authSecret === undefined) return yield* Effect.fail(new BadRequestError({}));
        return {
          visibility: value,
          accessCodeHash: yield* Effect.promise(() => hashAccessCode(accessCode, authSecret)),
          accessCodeFingerprint: yield* Effect.promise(() =>
            accessCodeFingerprint(accessCode, authSecret),
          ),
        };
      }
      if (accessCode !== undefined) return yield* Effect.fail(new BadRequestError({}));
      return { visibility: value, accessCodeHash: null, accessCodeFingerprint: null };
    });
    const accessCodeStatements = (
      documentId: string,
      visibility: {
        readonly accessCodeHash: string | null;
        readonly accessCodeFingerprint: string | null;
      },
      now: number,
    ): readonly D1PreparedStatement[] => {
      if (visibility.accessCodeHash === null || visibility.accessCodeFingerprint === null)
        return [];
      return [
        database
          .prepare(
            "UPDATE preview_access_codes SET used_at = ? WHERE document_id = ? AND used_at IS NULL",
          )
          .bind(now, documentId),
        database
          .prepare(
            "INSERT INTO preview_access_codes (id, document_id, code_hash, code_fingerprint, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            documentId,
            visibility.accessCodeHash,
            visibility.accessCodeFingerprint,
            now,
          ),
      ];
    };
    const create = Effect.fn("previews.create")(function* (input: PreviewCreateInput) {
      const decodedRequest = decodePreviewCreateRequest(input.request);
      if (decodedRequest._tag === "None") return yield* Effect.fail(new BadRequestError({}));
      const request = decodedRequest.value;
      const visibility = yield* visibilityHash(request.visibility, request.accessCode);
      const limits = limitsWithOverrides(
        yield* access.limitsForOrganization(input.organizationId),
        config,
      );
      const paths = new Set(request.files.map((file) => file.path));
      const totalBytes = request.files.reduce((total, file) => total + file.size, 0);
      if (
        !Number.isSafeInteger(totalBytes) ||
        request.files.some((file) => file.size > limits.maximumPreviewFileBytes) ||
        paths.size !== request.files.length ||
        (limits.maximumPreviewFiles !== null && request.files.length > limits.maximumPreviewFiles)
      )
        return yield* Effect.fail(new PreviewLimitError({}));
      const repoHost = request.repoHost ?? null;
      const repoOrg = request.repoOrg ?? null;
      const repoName = request.repoName ?? null;
      const group = request.group ?? null;
      const latestVersion = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT version, document_id FROM previews WHERE organization_id = ? AND name = ? AND group_name IS ? AND repo_host IS ? AND repo_org IS ? AND repo_name IS ? AND expires_at > ? ORDER BY version DESC LIMIT 1",
          )
          .bind(input.organizationId, request.name, group, repoHost, repoOrg, repoName, Date.now())
          .first<{ version: number; document_id: string | null }>(),
      );
      const current = yield* Effect.promise(() => {
        return database
          .prepare(
            "SELECT COUNT(*) AS count, COALESCE(SUM(total_bytes), 0) AS total FROM previews WHERE organization_id = ? AND expires_at > ?",
          )
          .bind(input.organizationId, Date.now())
          .first<{ count: number; total: number }>();
      });
      if (
        (limits.maximumPreviews !== null && (current?.count ?? 0) >= limits.maximumPreviews) ||
        (limits.maximumPreviewBytes !== null &&
          (current?.total ?? 0) + totalBytes > limits.maximumPreviewBytes)
      )
        return yield* Effect.fail(new PreviewLimitError({}));
      const now = Date.now();
      const id = previewId();
      const row: PreviewRow = {
        id,
        document_id: latestVersion?.document_id ?? id,
        name: request.name,
        version: (latestVersion?.version ?? 0) + 1,
        manifest: JSON.stringify(request.files),
        total_bytes: totalBytes,
        file_count: request.files.length,
        created_at: now,
        expires_at: now + limits.previewTTLSeconds * 1000,
        visibility: visibility.visibility,
        group_name: group,
        repo_host: repoHost,
        repo_org: repoOrg,
        repo_name: repoName,
      };
      const insert = database
        .prepare(
          "INSERT INTO previews (id, document_id, organization_id, user_id, name, version, manifest, total_bytes, file_count, created_at, expires_at, visibility, access_code_hash, group_name, repo_host, repo_org, repo_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          row.id,
          row.document_id,
          input.organizationId,
          input.userId,
          row.name,
          row.version,
          row.manifest,
          row.total_bytes,
          row.file_count,
          row.created_at,
          row.expires_at,
          row.visibility,
          visibility.accessCodeHash,
          row.group_name,
          row.repo_host,
          row.repo_org,
          row.repo_name,
        );
      yield* Effect.promise(() =>
        database.batch([insert, ...accessCodeStatements(row.document_id, visibility, now)]),
      );
      return response(row, config.previewDomain);
    });
    const update = Effect.fn("previews.update")(function* (
      input: PreviewIdentity & {
        readonly visibility: PreviewVisibility;
        readonly accessCode?: string;
      },
    ) {
      const visibility = yield* visibilityHash(input.visibility, input.accessCode);
      const now = Date.now();
      const existing = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT document_id FROM previews WHERE id = ? AND organization_id = ? AND expires_at > ?",
          )
          .bind(input.id, input.organizationId, now)
          .first<{ document_id: string | null }>(),
      );
      if (existing?.document_id === undefined || existing.document_id === null)
        return yield* Effect.fail(new NotFoundError({}));
      const documentId = existing.document_id;
      const updateStatement = database
        .prepare(
          "UPDATE previews SET visibility = ?, access_code_hash = ? WHERE id = ? AND organization_id = ? AND expires_at > ?",
        )
        .bind(
          visibility.visibility,
          visibility.accessCodeHash,
          input.id,
          input.organizationId,
          now,
        );
      yield* Effect.promise(() =>
        database.batch([updateStatement, ...accessCodeStatements(documentId, visibility, now)]),
      );
      const value = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT id, document_id, name, version, manifest, total_bytes, file_count, created_at, expires_at, visibility, group_name, repo_host, repo_org, repo_name FROM previews WHERE id = ? AND organization_id = ? AND expires_at > ?",
          )
          .bind(input.id, input.organizationId, now)
          .first(),
      );
      const decoded = decodePreviewRow(value);
      if (decoded._tag === "None") return yield* Effect.fail(new NotFoundError({}));
      return response(decoded.value, config.previewDomain);
    });
    const upload = Effect.fn("previews.upload")(function* (input: PreviewUploadInput) {
      const value = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT manifest, expires_at FROM previews WHERE id = ? AND organization_id = ? AND user_id = ?",
          )
          .bind(input.id, input.organizationId, input.userId)
          .first(),
      );
      const decoded = decodePreviewUploadRow(value);
      if (decoded._tag === "None" || decoded.value.expires_at <= Date.now())
        return yield* Effect.fail(new NotFoundError({}));
      const files = parseManifest(decoded.value.manifest);
      if (files === null) return yield* Effect.fail(new InvalidManifestError({}));
      const file = files.find((entry) => entry.path === input.path);
      if (file === undefined || input.contentLength !== String(file.size))
        return yield* Effect.fail(new BadRequestError({}));
      const exactSize = yield* Effect.promise(() =>
        putPreviewObject(
          bucket,
          `${input.id}/${input.path}`,
          input.body,
          file.size,
          file.contentType,
          file.sha256,
        ),
      );
      if (!exactSize) return yield* Effect.fail(new BadRequestError({}));
    });
    const list = Effect.fn("previews.list")(function* (organizationId: string) {
      const result = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT id, document_id, name, version, manifest, total_bytes, file_count, created_at, expires_at, visibility, group_name, repo_host, repo_org, repo_name FROM previews WHERE organization_id = ? AND expires_at > ? ORDER BY created_at DESC",
          )
          .bind(organizationId, Date.now())
          .all(),
      );
      return result.results.flatMap((value): readonly PreviewView[] => {
        const decoded = decodePreviewRow(value);
        return decoded._tag === "None" ? [] : [response(decoded.value, config.previewDomain)];
      });
    });
    const versions = Effect.fn("previews.versions")(function* (input: PreviewDocumentIdentity) {
      const result = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT id, document_id, name, version, manifest, total_bytes, file_count, created_at, expires_at, visibility, group_name, repo_host, repo_org, repo_name FROM previews WHERE organization_id = ? AND document_id = ? AND expires_at > ? ORDER BY version DESC",
          )
          .bind(input.organizationId, input.documentId, Date.now())
          .all(),
      );
      const values = result.results.flatMap((value): readonly PreviewView[] => {
        const decoded = decodePreviewRow(value);
        return decoded._tag === "None" ? [] : [response(decoded.value, config.previewDomain)];
      });
      if (values.length === 0) return yield* Effect.fail(new NotFoundError({}));
      return values;
    });
    const accessFor = Effect.fn("previews.access")(function* (input: PreviewAccessIdentity) {
      const now = Date.now();
      const preview = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT document_id FROM previews WHERE id = ? AND organization_id = ? AND expires_at > ?",
          )
          .bind(input.previewId, input.organizationId, now)
          .first<{ document_id: string | null }>(),
      );
      if (preview?.document_id === undefined || preview.document_id === null)
        return yield* Effect.fail(new NotFoundError({}));
      const codes = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT id, created_at FROM preview_access_codes WHERE document_id = ? AND used_at IS NULL ORDER BY created_at DESC",
          )
          .bind(preview.document_id)
          .all(),
      );
      const sessions = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT session_hash, created_at, expires_at FROM preview_access_grants WHERE document_id = ? AND expires_at > ? ORDER BY created_at DESC",
          )
          .bind(preview.document_id, now)
          .all(),
      );
      return {
        codes: codes.results.flatMap((value): readonly PreviewAccessCodeView[] => {
          const id = recordValue(value, "id");
          const createdAt = recordValue(value, "created_at");
          return typeof id === "string" && typeof createdAt === "number" ? [{ id, createdAt }] : [];
        }),
        sessions: sessions.results.flatMap((value): readonly PreviewAccessSessionView[] => {
          const id = recordValue(value, "session_hash");
          const createdAt = recordValue(value, "created_at");
          const expiresAt = recordValue(value, "expires_at");
          return typeof id === "string" &&
            typeof createdAt === "number" &&
            typeof expiresAt === "number"
            ? [{ id, createdAt, expiresAt }]
            : [];
        }),
      };
    });
    const removeAccess = Effect.fn("previews.remove_access")(function* (
      table: "preview_access_codes" | "preview_access_grants",
      idColumn: "id" | "session_hash",
      input: PreviewAccessItemIdentity,
    ) {
      const result = yield* Effect.promise(() =>
        database
          .prepare(
            `DELETE FROM ${table} WHERE ${idColumn} = ? AND document_id IN (SELECT document_id FROM previews WHERE id = ? AND organization_id = ? AND expires_at > ?)`,
          )
          .bind(input.id, input.previewId, input.organizationId, Date.now())
          .run(),
      );
      if (result.meta.changes === 0) return yield* Effect.fail(new NotFoundError({}));
    });
    const deleteAccessCode = Effect.fn("previews.delete_access_code")(
      (input: PreviewAccessItemIdentity) => removeAccess("preview_access_codes", "id", input),
    );
    const revokeAccessSession = Effect.fn("previews.revoke_access_session")(
      (input: PreviewAccessItemIdentity) =>
        removeAccess("preview_access_grants", "session_hash", input),
    );
    const remove = Effect.fn("previews.delete")(function* (input: PreviewIdentity) {
      const value = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT id, document_id, name, version, manifest, total_bytes, file_count, created_at, expires_at, visibility, group_name, repo_host, repo_org, repo_name FROM previews WHERE id = ? AND organization_id = ? AND user_id = ?",
          )
          .bind(input.id, input.organizationId, input.userId)
          .first(),
      );
      const decoded = decodePreviewRow(value);
      if (decoded._tag === "None") return yield* Effect.fail(new NotFoundError({}));
      yield* deletePrefix(input.id);
      yield* Effect.promise(() =>
        database.prepare("DELETE FROM previews WHERE id = ?").bind(input.id).run(),
      );
      return response(decoded.value, config.previewDomain);
    });
    const cleanupExpired = Effect.fn("previews.cleanup_expired")(function* () {
      const expired = yield* Effect.promise(() =>
        database
          .prepare("SELECT id FROM previews WHERE expires_at < ? LIMIT 100")
          .bind(Date.now())
          .all<{ id: string }>(),
      );
      for (const row of expired.results) {
        yield* deletePrefix(row.id);
        yield* Effect.promise(() =>
          database.prepare("DELETE FROM previews WHERE id = ?").bind(row.id).run(),
        );
      }
    });
    const findForServing = Effect.fn("previews.find_for_serving")(function* (id: string) {
      const value = yield* Effect.promise(() =>
        database
          .prepare("SELECT expires_at, visibility, access_code_hash FROM previews WHERE id = ?")
          .bind(id)
          .first(),
      );
      const expiresAt = recordValue(value, "expires_at");
      const visibility = recordValue(value, "visibility");
      const accessCodeHash = recordValue(value, "access_code_hash");
      if (typeof expiresAt !== "number" || typeof visibility !== "string") return null;
      return {
        expiresAt,
        visibility,
        accessCodeHash: typeof accessCodeHash === "string" ? accessCodeHash : null,
      };
    });
    return Previews.of({
      create,
      update,
      upload,
      list,
      versions,
      access: accessFor,
      deleteAccessCode,
      revokeAccessSession,
      delete: remove,
      cleanupExpired,
      findForServing,
    });
  }),
);

function recordValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
}
