import { Context, Effect, Layer, Schema } from "effect";
import { DomainsDatabase, TunnelRegistry } from "./bindings.js";
import { CoreConfig } from "./config.js";
import {
  DomainConflictError,
  DomainUpstreamError,
  DomainsNotConfiguredError,
  NotFoundError,
} from "./errors.js";
import { DomainView, type DomainStatus } from "./schemas.js";

const PENDING_DOMAIN_TTL_MS = 72 * 60 * 60 * 1000;

interface DomainRecord {
  readonly hostname: string;
  readonly tunnelId: string;
  readonly organizationId: string;
  readonly verificationToken: string;
  readonly status: DomainStatus;
  readonly cloudflareHostnameId: string | null;
  readonly error: string | null;
  readonly lastUsedAt: number | null;
}

export interface DomainListView {
  readonly domains: readonly DomainView[];
}

export interface AddDomainInput {
  readonly hostname: string;
  readonly tunnelId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly maximumDomains: number | null;
}

export type DomainSuccess = { readonly domain: DomainView; readonly created?: true };
export type DomainResult = DomainSuccess;
type DomainError =
  | DomainConflictError
  | DomainUpstreamError
  | DomainsNotConfiguredError
  | NotFoundError;

const DomainRecordSchema = Schema.Struct({
  hostname: Schema.String,
  tunnel_id: Schema.String,
  organization_id: Schema.String,
  verification_token: Schema.String,
  status: Schema.Literals(["pending_dns", "provisioning", "active", "failed"]),
  cloudflare_hostname_id: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  last_used_at: Schema.NullOr(Schema.Number),
});
const decodeDomainRecord = Schema.decodeUnknownOption(DomainRecordSchema);

function parseRecord(value: unknown): DomainRecord | null {
  const decoded = decodeDomainRecord(value);
  if (decoded._tag === "None") return null;
  return {
    hostname: decoded.value.hostname,
    tunnelId: decoded.value.tunnel_id,
    organizationId: decoded.value.organization_id,
    verificationToken: decoded.value.verification_token,
    status: decoded.value.status,
    cloudflareHostnameId: decoded.value.cloudflare_hostname_id,
    error: decoded.value.error,
    lastUsedAt: decoded.value.last_used_at,
  };
}

function verificationName(hostname: string): string {
  return `_mtunnel.${hostname}`;
}

function verificationValue(token: string): string {
  return `mtunnel-verification=${token}`;
}

function view(record: DomainRecord, cname: string): DomainView {
  const result: DomainView = {
    hostname: record.hostname,
    tunnelId: record.tunnelId,
    status: record.status,
    cname: { type: "CNAME", name: record.hostname, value: cname },
    verification: {
      type: "TXT",
      name: verificationName(record.hostname),
      value: verificationValue(record.verificationToken),
    },
    lastUsedAt: record.lastUsedAt === null ? null : new Date(record.lastUsedAt).toISOString(),
  };
  return record.error === null ? result : { ...result, error: record.error };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function recordValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloudflareFailure(input: unknown, status: number): string {
  const errors = recordValue(input, "errors");
  if (Array.isArray(errors)) {
    for (const error of errors) {
      const message = recordValue(error, "message");
      if (typeof message === "string") return message;
    }
  }
  return `Cloudflare returned status ${status}`;
}

function cloudflareHostname(
  input: unknown,
): { readonly id: string; readonly active: boolean } | null {
  const result = recordValue(input, "result");
  const id = recordValue(result, "id");
  const status = recordValue(result, "status");
  const sslStatus = recordValue(recordValue(result, "ssl"), "status");
  if (typeof id !== "string") return null;
  return { id, active: status === "active" && sslStatus === "active" };
}

async function hasVerificationRecord(record: DomainRecord): Promise<boolean> {
  const target = new URL("https://cloudflare-dns.com/dns-query");
  target.searchParams.set("name", verificationName(record.hostname));
  target.searchParams.set("type", "TXT");
  const response = await fetch(target, { headers: { accept: "application/dns-json" } });
  if (!response.ok) return false;
  const value: unknown = await response.json();
  const answers = recordValue(value, "Answer");
  if (!Array.isArray(answers)) return false;
  return answers.some(
    (answer) => recordValue(answer, "data") === verificationValue(record.verificationToken),
  );
}

export class CustomDomains extends Context.Service<
  CustomDomains,
  {
    readonly add: (input: AddDomainInput) => Effect.Effect<DomainSuccess, DomainError>;
    readonly verify: (
      hostname: string,
      organizationId: string,
      userId: string,
    ) => Effect.Effect<DomainSuccess, DomainError>;
    readonly status: (
      hostname: string,
      organizationId: string,
      userId: string,
    ) => Effect.Effect<DomainSuccess, DomainError>;
    readonly list: (organizationId: string, userId: string) => Effect.Effect<DomainListView>;
    readonly delete: (
      hostname: string,
      organizationId: string,
      userId: string,
    ) => Effect.Effect<DomainSuccess, DomainError>;
    readonly markUsed: (hostname: string) => Effect.Effect<void>;
    readonly tunnelIdForDomain: (hostname: string) => Effect.Effect<string | null>;
  }
>()("@tunnel/core/domains/CustomDomains") {}

export const customDomainsLayer = Layer.effect(
  CustomDomains,
  Effect.gen(function* () {
    const database = yield* DomainsDatabase;
    const registry = yield* TunnelRegistry;
    const config = yield* CoreConfig;
    const find = Effect.fn("domains.find")(function* (hostname: string) {
      const value = yield* Effect.promise(() =>
        database
          .prepare(
            `SELECT hostname, tunnel_id, organization_id, verification_token, status,
                    cloudflare_hostname_id, error, last_used_at
               FROM custom_domains WHERE hostname = ?`,
          )
          .bind(hostname)
          .first(),
      );
      return parseRecord(value);
    });
    const migrate = Effect.fn("domains.migrate_legacy")(function* (
      record: DomainRecord | null,
      organizationId: string,
      userId: string,
    ) {
      if (record === null || record.organizationId !== userId) return record;
      yield* Effect.promise(() =>
        database
          .prepare(
            "UPDATE custom_domains SET organization_id = ?, updated_at = ? WHERE hostname = ?",
          )
          .bind(organizationId, Date.now(), record.hostname)
          .run(),
      );
      return { ...record, organizationId };
    });
    const saveProvisioning = Effect.fn("domains.save_provisioning")(function* (
      record: DomainRecord,
      hostnameId: string,
      status: "provisioning" | "active",
    ) {
      yield* Effect.promise(() =>
        database
          .prepare(
            `UPDATE custom_domains
                SET status = ?, cloudflare_hostname_id = ?, error = NULL, updated_at = ?
              WHERE hostname = ? AND organization_id = ?`,
          )
          .bind(status, hostnameId, Date.now(), record.hostname, record.organizationId)
          .run(),
      );
      return { ...record, status, cloudflareHostnameId: hostnameId, error: null };
    });
    const saveFailure = Effect.fn("domains.save_failure")(function* (
      record: DomainRecord,
      message: string,
    ) {
      yield* Effect.promise(() =>
        database
          .prepare(
            `UPDATE custom_domains SET status = 'failed', error = ?, updated_at = ?
              WHERE hostname = ? AND organization_id = ?`,
          )
          .bind(message, Date.now(), record.hostname, record.organizationId)
          .run(),
      );
    });

    const add = Effect.fn("domains.add")(function* (input: AddDomainInput) {
      yield* Effect.promise(() =>
        database
          .prepare(
            "DELETE FROM custom_domains WHERE hostname = ? AND status = 'pending_dns' AND created_at < ?",
          )
          .bind(input.hostname, Date.now() - PENDING_DOMAIN_TTL_MS)
          .run(),
      );
      const existing = yield* find(input.hostname);
      if (existing === null && input.maximumDomains !== null) {
        const count = yield* Effect.promise(() =>
          database
            .prepare("SELECT COUNT(*) AS total FROM custom_domains WHERE organization_id = ?")
            .bind(input.organizationId)
            .first<{ total: number }>(),
        );
        if ((count?.total ?? 0) >= input.maximumDomains)
          return yield* Effect.fail(
            new DomainConflictError({ code: "custom_domain_limit_reached" }),
          );
      }
      const claimed = yield* registry.claimTunnel(
        input.tunnelId,
        input.organizationId,
        input.userId,
      );
      if (!claimed)
        return yield* Effect.fail(new DomainConflictError({ code: "domain_or_tunnel_taken" }));
      const now = Date.now();
      const inserted = yield* Effect.promise(() =>
        database
          .prepare(
            `INSERT INTO custom_domains
               (hostname, tunnel_id, organization_id, verification_token, status, created_at, updated_at)
             SELECT ?, ?, ?, ?, 'pending_dns', ?, ?
              WHERE ? IS NULL OR (SELECT COUNT(*) FROM custom_domains WHERE organization_id = ?) < ?
             ON CONFLICT(hostname) DO NOTHING`,
          )
          .bind(
            input.hostname,
            input.tunnelId,
            input.organizationId,
            randomToken(),
            now,
            now,
            input.maximumDomains,
            input.organizationId,
            input.maximumDomains,
          )
          .run(),
      );
      const record = yield* find(input.hostname);
      if (record === null && inserted.meta.changes === 0)
        return yield* Effect.fail(new DomainConflictError({ code: "custom_domain_limit_reached" }));
      if (record === null)
        return yield* Effect.fail(new DomainUpstreamError({ code: "domain_storage_failed" }));
      if (record.organizationId !== input.organizationId || record.tunnelId !== input.tunnelId)
        return yield* Effect.fail(new DomainConflictError({ code: "domain_or_tunnel_taken" }));
      if (inserted.meta.changes > 0) {
        const created: DomainSuccess = {
          domain: view(record, config.customDomainCname),
          created: true,
        };
        return created;
      }
      return { domain: view(record, config.customDomainCname) };
    });

    const verifyOrStatus = Effect.fn("domains.verify_or_status")(function* (
      hostname: string,
      organizationId: string,
      userId: string,
      verify: boolean,
    ) {
      const record = yield* migrate(yield* find(hostname), organizationId, userId);
      if (record === null || record.organizationId !== organizationId)
        return yield* Effect.fail(new NotFoundError({}));
      if (!verify) {
        if (
          record.status !== "provisioning" ||
          record.cloudflareHostnameId === null ||
          config.cloudflareApiToken === undefined ||
          config.cloudflareZoneId === undefined
        )
          return { domain: view(record, config.customDomainCname) };
        const response = yield* Effect.promise(() =>
          fetch(
            `https://api.cloudflare.com/client/v4/zones/${config.cloudflareZoneId}/custom_hostnames/${record.cloudflareHostnameId}`,
            { headers: { authorization: `Bearer ${config.cloudflareApiToken}` } },
          ),
        );
        if (!response.ok) return { domain: view(record, config.customDomainCname) };
        const provisioned = cloudflareHostname(yield* Effect.promise(() => response.json()));
        if (provisioned === null || !provisioned.active)
          return { domain: view(record, config.customDomainCname) };
        const saved = yield* saveProvisioning(record, provisioned.id, "active");
        return { domain: view(saved, config.customDomainCname) };
      }
      if (record.status === "active" || record.status === "provisioning")
        return { domain: view(record, config.customDomainCname) };
      if (!(yield* Effect.promise(() => hasVerificationRecord(record))))
        return yield* Effect.fail(
          new DomainConflictError({
            code: "dns_verification_pending",
            message: "TXT verification record not found",
            domain: view(record, config.customDomainCname),
          }),
        );
      if (config.cloudflareApiToken === undefined || config.cloudflareZoneId === undefined)
        return yield* Effect.fail(new DomainsNotConfiguredError({}));
      const response = yield* Effect.promise(() =>
        fetch(
          `https://api.cloudflare.com/client/v4/zones/${config.cloudflareZoneId}/custom_hostnames`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.cloudflareApiToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } }),
          },
        ),
      );
      const value = yield* Effect.promise(() => response.json().catch((): null => null));
      if (!response.ok) {
        const message = cloudflareFailure(value, response.status);
        yield* saveFailure(record, message);
        return yield* Effect.fail(
          new DomainUpstreamError({ code: "custom_domain_provision_failed", message }),
        );
      }
      const provisioned = cloudflareHostname(value);
      if (provisioned === null) {
        const message = "Cloudflare response missing custom hostname";
        yield* saveFailure(record, message);
        return yield* Effect.fail(
          new DomainUpstreamError({ code: "custom_domain_provision_failed", message }),
        );
      }
      const saved = yield* saveProvisioning(
        record,
        provisioned.id,
        provisioned.active ? "active" : "provisioning",
      );
      return { domain: view(saved, config.customDomainCname) };
    });

    const list = Effect.fn("domains.list")(function* (organizationId: string, userId: string) {
      const legacy = yield* Effect.promise(() =>
        database
          .prepare("SELECT hostname FROM custom_domains WHERE organization_id = ? LIMIT 1")
          .bind(userId)
          .first<{ hostname: string }>(),
      );
      if (legacy !== null)
        yield* Effect.promise(() =>
          database
            .prepare(
              "UPDATE custom_domains SET organization_id = ?, updated_at = ? WHERE organization_id = ?",
            )
            .bind(organizationId, Date.now(), userId)
            .run(),
        );
      const result = yield* Effect.promise(() =>
        database
          .prepare(
            `SELECT hostname, tunnel_id, organization_id, verification_token, status,
                    cloudflare_hostname_id, error, last_used_at
               FROM custom_domains WHERE organization_id = ? ORDER BY created_at DESC`,
          )
          .bind(organizationId)
          .all(),
      );
      return {
        domains: result.results.flatMap((value): readonly DomainView[] => {
          const record = parseRecord(value);
          return record === null ? [] : [view(record, config.customDomainCname)];
        }),
      };
    });

    const remove = Effect.fn("domains.delete")(function* (
      hostname: string,
      organizationId: string,
      userId: string,
    ) {
      const record = yield* migrate(yield* find(hostname), organizationId, userId);
      if (record === null || record.organizationId !== organizationId)
        return yield* Effect.fail(new NotFoundError({}));
      if (record.cloudflareHostnameId !== null) {
        if (config.cloudflareApiToken === undefined || config.cloudflareZoneId === undefined)
          return yield* Effect.fail(new DomainsNotConfiguredError({}));
        const response = yield* Effect.promise(() =>
          fetch(
            `https://api.cloudflare.com/client/v4/zones/${config.cloudflareZoneId}/custom_hostnames/${record.cloudflareHostnameId}`,
            { method: "DELETE", headers: { authorization: `Bearer ${config.cloudflareApiToken}` } },
          ),
        );
        if (!response.ok && response.status !== 404)
          return yield* Effect.fail(
            new DomainUpstreamError({
              code: "custom_domain_delete_failed",
              message: cloudflareFailure(
                yield* Effect.promise(() => response.json().catch((): null => null)),
                response.status,
              ),
            }),
          );
      }
      yield* Effect.promise(() =>
        database
          .prepare("DELETE FROM custom_domains WHERE hostname = ? AND organization_id = ?")
          .bind(hostname, organizationId)
          .run(),
      );
      return { domain: view(record, config.customDomainCname) };
    });
    const markUsed = Effect.fn("domains.mark_used")(function* (hostname: string) {
      const now = Date.now();
      yield* Effect.promise(() =>
        database
          .prepare(
            "UPDATE custom_domains SET last_used_at = ?, updated_at = ? WHERE hostname = ? AND (last_used_at IS NULL OR last_used_at < ?)",
          )
          .bind(now, now, hostname, now - 60_000)
          .run(),
      );
    });
    const tunnelIdForDomain = Effect.fn("domains.tunnel_id_for_domain")(function* (
      hostname: string,
    ) {
      const value = yield* Effect.promise(() =>
        database
          .prepare(
            "SELECT tunnel_id FROM custom_domains WHERE hostname = ? AND status IN ('provisioning', 'active')",
          )
          .bind(hostname)
          .first(),
      );
      const tunnelId = recordValue(value, "tunnel_id");
      return typeof tunnelId === "string" ? tunnelId : null;
    });
    return CustomDomains.of({
      add,
      verify: (hostname, organizationId, userId) =>
        verifyOrStatus(hostname, organizationId, userId, true),
      status: (hostname, organizationId, userId) =>
        verifyOrStatus(hostname, organizationId, userId, false),
      list,
      delete: remove,
      markUsed,
      tunnelIdForDomain,
    });
  }),
);
