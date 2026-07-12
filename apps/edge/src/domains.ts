import type { Env } from "./env.js";

// A hostname registered but never DNS-verified is released after this long, so
// it can't be squatted on forever and block the real owner from claiming it.
const PENDING_DOMAIN_TTL_MS = 72 * 60 * 60 * 1000;

export type DomainStatus = "pending_dns" | "provisioning" | "active" | "failed";

export interface DomainView {
  readonly hostname: string;
  readonly tunnelId: string;
  readonly status: DomainStatus;
  readonly cname: { readonly type: "CNAME"; readonly name: string; readonly value: string };
  readonly verification: { readonly type: "TXT"; readonly name: string; readonly value: string };
  readonly error?: string;
  readonly lastUsedAt: string | null;
}

export interface DomainListView {
  readonly domains: readonly DomainView[];
}

export type DomainResult =
  | { readonly ok: true; readonly domain: DomainView; readonly created?: true }
  | {
      readonly ok: false;
      readonly status: 404 | 409 | 502 | 503;
      readonly error: string;
      readonly message?: string;
      readonly domain?: DomainView;
    };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDomainStatus(value: unknown): value is DomainStatus {
  return (
    value === "pending_dns" || value === "provisioning" || value === "active" || value === "failed"
  );
}

function parseDomainRecord(value: unknown): DomainRecord | null {
  if (
    !isRecord(value) ||
    typeof value.hostname !== "string" ||
    typeof value.tunnel_id !== "string" ||
    typeof value.organization_id !== "string" ||
    typeof value.verification_token !== "string" ||
    !isDomainStatus(value.status) ||
    (value.cloudflare_hostname_id !== null && typeof value.cloudflare_hostname_id !== "string") ||
    (value.error !== null && typeof value.error !== "string") ||
    (value.last_used_at !== null && typeof value.last_used_at !== "number")
  )
    return null;
  return {
    hostname: value.hostname,
    tunnelId: value.tunnel_id,
    organizationId: value.organization_id,
    verificationToken: value.verification_token,
    status: value.status,
    cloudflareHostnameId: value.cloudflare_hostname_id,
    error: value.error,
    lastUsedAt: value.last_used_at,
  };
}

function verificationName(hostname: string): string {
  return `_mtunnel.${hostname}`;
}

function verificationValue(token: string): string {
  return `mtunnel-verification=${token}`;
}

function view(record: DomainRecord, tunnelDomain: string): DomainView {
  const result: DomainView = {
    hostname: record.hostname,
    tunnelId: record.tunnelId,
    status: record.status,
    cname: { type: "CNAME", name: record.hostname, value: tunnelDomain },
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

async function reapStaleDomain(env: Env, hostname: string): Promise<void> {
  await env.DOMAINS.prepare(
    `DELETE FROM custom_domains
      WHERE hostname = ? AND status = 'pending_dns' AND created_at < ?`,
  )
    .bind(hostname, Date.now() - PENDING_DOMAIN_TTL_MS)
    .run();
}

async function findDomain(env: Env, hostname: string): Promise<DomainRecord | null> {
  const value: unknown = await env.DOMAINS.prepare(
    `SELECT hostname, tunnel_id, organization_id, verification_token, status,
            cloudflare_hostname_id, error, last_used_at
       FROM custom_domains WHERE hostname = ?`,
  )
    .bind(hostname)
    .first();
  return parseDomainRecord(value);
}

async function migrateLegacyDomain(
  env: Env,
  record: DomainRecord | null,
  organizationId: string,
  userId: string,
): Promise<DomainRecord | null> {
  if (record === null || record.organizationId !== userId) return record;
  await env.DOMAINS.prepare(
    "UPDATE custom_domains SET organization_id = ?, updated_at = ? WHERE hostname = ?",
  )
    .bind(organizationId, Date.now(), record.hostname)
    .run();
  return { ...record, organizationId };
}

export async function addDomain(
  env: Env,
  input: {
    readonly hostname: string;
    readonly tunnelId: string;
    readonly organizationId: string;
    readonly userId: string;
    readonly maximumDomains: number | null;
  },
): Promise<DomainResult> {
  await reapStaleDomain(env, input.hostname);
  const existing = await findDomain(env, input.hostname);
  if (existing === null && input.maximumDomains !== null) {
    const count = await env.DOMAINS.prepare(
      "SELECT COUNT(*) AS total FROM custom_domains WHERE organization_id = ?",
    )
      .bind(input.organizationId)
      .first<{ total: number }>();
    if ((count?.total ?? 0) >= input.maximumDomains)
      return { ok: false, status: 409, error: "custom_domain_limit_reached" };
  }
  const claimed = await env.REGISTRY.getByName("global").claimTunnel(
    input.tunnelId,
    input.organizationId,
    input.userId,
  );
  if (!claimed) return { ok: false, status: 409, error: "domain_or_tunnel_taken" };
  await env.DOMAINS.prepare(
    `UPDATE custom_domains SET organization_id = ?, updated_at = ?
      WHERE hostname = ? AND organization_id = ?`,
  )
    .bind(input.organizationId, Date.now(), input.hostname, input.userId)
    .run();
  const now = Date.now();
  const inserted = await env.DOMAINS.prepare(
    `INSERT INTO custom_domains
       (hostname, tunnel_id, organization_id, verification_token, status, created_at, updated_at)
     SELECT ?, ?, ?, ?, 'pending_dns', ?, ?
      WHERE ? IS NULL OR (
        SELECT COUNT(*) FROM custom_domains WHERE organization_id = ?
      ) < ?
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
    .run();
  const record = await findDomain(env, input.hostname);
  if (record === null && inserted.meta.changes === 0)
    return { ok: false, status: 409, error: "custom_domain_limit_reached" };
  if (record === null) return { ok: false, status: 502, error: "domain_storage_failed" };
  if (record.organizationId !== input.organizationId || record.tunnelId !== input.tunnelId)
    return { ok: false, status: 409, error: "domain_or_tunnel_taken" };
  return inserted.meta.changes > 0
    ? { ok: true, domain: view(record, env.CUSTOM_DOMAIN_CNAME), created: true }
    : { ok: true, domain: view(record, env.CUSTOM_DOMAIN_CNAME) };
}

function parseDnsAnswers(value: unknown): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value.Answer)) return [];
  return value.Answer.flatMap((answer): readonly string[] =>
    isRecord(answer) && typeof answer.data === "string" ? [answer.data] : [],
  );
}

async function hasVerificationRecord(record: DomainRecord): Promise<boolean> {
  const target = new URL("https://cloudflare-dns.com/dns-query");
  target.searchParams.set("name", verificationName(record.hostname));
  target.searchParams.set("type", "TXT");
  const response = await fetch(target, { headers: { accept: "application/dns-json" } });
  if (!response.ok) return false;
  const value: unknown = await response.json();
  const expected = verificationValue(record.verificationToken);
  return parseDnsAnswers(value).some((answer) => answer.replaceAll('"', "") === expected);
}

function cloudflareFailure(value: unknown, status: number): string {
  if (isRecord(value) && Array.isArray(value.errors)) {
    for (const error of value.errors) {
      if (isRecord(error) && typeof error.message === "string") return error.message;
    }
  }
  return `Cloudflare returned status ${status}`;
}

function cloudflareHostname(
  value: unknown,
): { readonly id: string; readonly active: boolean } | null {
  if (!isRecord(value) || !isRecord(value.result) || typeof value.result.id !== "string")
    return null;
  const sslActive = isRecord(value.result.ssl) && value.result.ssl.status === "active";
  return { id: value.result.id, active: value.result.status === "active" && sslActive };
}

function listedCloudflareHostname(
  value: unknown,
): { readonly id: string; readonly active: boolean } | null {
  if (!isRecord(value) || !Array.isArray(value.result)) return null;
  for (const result of value.result) {
    const parsed = cloudflareHostname({ result });
    if (parsed !== null) return parsed;
  }
  return null;
}

async function existingCloudflareHostname(
  env: Env,
  hostname: string,
): Promise<{ readonly id: string; readonly active: boolean } | null> {
  if (env.CLOUDFLARE_API_TOKEN === undefined || env.CLOUDFLARE_ZONE_ID === undefined) return null;
  const target = new URL(
    `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames`,
  );
  target.searchParams.set("hostname", hostname);
  const response = await fetch(target, {
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  });
  if (!response.ok) return null;
  const value: unknown = await response.json().catch((): null => null);
  return listedCloudflareHostname(value);
}

async function saveProvisioningResult(
  env: Env,
  record: DomainRecord,
  hostnameId: string,
  status: "provisioning" | "active",
): Promise<DomainRecord> {
  await env.DOMAINS.prepare(
    `UPDATE custom_domains
        SET status = ?, cloudflare_hostname_id = ?, error = NULL, updated_at = ?
      WHERE hostname = ? AND organization_id = ?`,
  )
    .bind(status, hostnameId, Date.now(), record.hostname, record.organizationId)
    .run();
  return { ...record, status, cloudflareHostnameId: hostnameId, error: null };
}

async function saveFailure(env: Env, record: DomainRecord, message: string): Promise<void> {
  await env.DOMAINS.prepare(
    `UPDATE custom_domains SET status = 'failed', error = ?, updated_at = ?
      WHERE hostname = ? AND organization_id = ?`,
  )
    .bind(message, Date.now(), record.hostname, record.organizationId)
    .run();
}

export async function verifyDomain(
  env: Env,
  hostname: string,
  organizationId: string,
  userId: string,
): Promise<DomainResult> {
  const record = await migrateLegacyDomain(
    env,
    await findDomain(env, hostname),
    organizationId,
    userId,
  );
  if (record === null || record.organizationId !== organizationId)
    return { ok: false, status: 404, error: "not_found" };
  if (record.status === "active" || record.status === "provisioning")
    return { ok: true, domain: view(record, env.CUSTOM_DOMAIN_CNAME) };
  if (!(await hasVerificationRecord(record))) {
    return {
      ok: false,
      status: 409,
      error: "dns_verification_pending",
      message: "TXT verification record not found",
      domain: view(record, env.CUSTOM_DOMAIN_CNAME),
    };
  }
  if (env.CLOUDFLARE_API_TOKEN === undefined || env.CLOUDFLARE_ZONE_ID === undefined)
    return { ok: false, status: 503, error: "custom_domains_not_configured" };
  const upstream = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } }),
    },
  );
  const value: unknown = await upstream.json().catch((): null => null);
  if (!upstream.ok) {
    const existing =
      upstream.status === 409 ? await existingCloudflareHostname(env, hostname) : null;
    if (existing !== null) {
      const saved = await saveProvisioningResult(
        env,
        record,
        existing.id,
        existing.active ? "active" : "provisioning",
      );
      return { ok: true, domain: view(saved, env.CUSTOM_DOMAIN_CNAME) };
    }
    const message = cloudflareFailure(value, upstream.status);
    await saveFailure(env, record, message);
    return { ok: false, status: 502, error: "custom_domain_provision_failed", message };
  }
  const provisioned = cloudflareHostname(value);
  if (provisioned === null) {
    const message = "Cloudflare response missing custom hostname";
    await saveFailure(env, record, message);
    return { ok: false, status: 502, error: "custom_domain_provision_failed", message };
  }
  const saved = await saveProvisioningResult(
    env,
    record,
    provisioned.id,
    provisioned.active ? "active" : "provisioning",
  );
  return { ok: true, domain: view(saved, env.CUSTOM_DOMAIN_CNAME) };
}

export async function domainStatus(
  env: Env,
  hostname: string,
  organizationId: string,
  userId: string,
): Promise<DomainResult> {
  const record = await migrateLegacyDomain(
    env,
    await findDomain(env, hostname),
    organizationId,
    userId,
  );
  if (record === null || record.organizationId !== organizationId)
    return { ok: false, status: 404, error: "not_found" };
  if (
    record.status !== "provisioning" ||
    record.cloudflareHostnameId === null ||
    env.CLOUDFLARE_API_TOKEN === undefined ||
    env.CLOUDFLARE_ZONE_ID === undefined
  )
    return { ok: true, domain: view(record, env.CUSTOM_DOMAIN_CNAME) };
  const upstream = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${record.cloudflareHostnameId}`,
    { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
  );
  if (!upstream.ok) return { ok: true, domain: view(record, env.CUSTOM_DOMAIN_CNAME) };
  const value: unknown = await upstream.json().catch((): null => null);
  const provisioned = cloudflareHostname(value);
  if (provisioned === null || !provisioned.active)
    return { ok: true, domain: view(record, env.CUSTOM_DOMAIN_CNAME) };
  const saved = await saveProvisioningResult(env, record, provisioned.id, "active");
  return { ok: true, domain: view(saved, env.CUSTOM_DOMAIN_CNAME) };
}

export async function listDomains(
  env: Env,
  organizationId: string,
  userId: string,
): Promise<DomainListView> {
  await env.DOMAINS.prepare(
    `UPDATE custom_domains SET organization_id = ?, updated_at = ?
      WHERE organization_id = ?`,
  )
    .bind(organizationId, Date.now(), userId)
    .run();
  const result = await env.DOMAINS.prepare(
    `SELECT hostname, tunnel_id, organization_id, verification_token, status,
            cloudflare_hostname_id, error, last_used_at
       FROM custom_domains
      WHERE organization_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(organizationId)
    .all();
  return {
    domains: result.results.flatMap((value): readonly DomainView[] => {
      const record = parseDomainRecord(value);
      return record === null ? [] : [view(record, env.CUSTOM_DOMAIN_CNAME)];
    }),
  };
}

export async function deleteDomain(
  env: Env,
  hostname: string,
  organizationId: string,
  userId: string,
): Promise<DomainResult | null> {
  const record = await migrateLegacyDomain(
    env,
    await findDomain(env, hostname),
    organizationId,
    userId,
  );
  if (record === null || record.organizationId !== organizationId) return null;
  if (record.cloudflareHostnameId !== null) {
    if (env.CLOUDFLARE_API_TOKEN === undefined || env.CLOUDFLARE_ZONE_ID === undefined)
      return { ok: false, status: 503, error: "custom_domains_not_configured" };
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${record.cloudflareHostnameId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      },
    );
    if (!response.ok && response.status !== 404) {
      return {
        ok: false,
        status: 502,
        error: "custom_domain_delete_failed",
        message: cloudflareFailure(await response.json().catch((): null => null), response.status),
      };
    }
  }
  await env.DOMAINS.prepare("DELETE FROM custom_domains WHERE hostname = ? AND organization_id = ?")
    .bind(hostname, organizationId)
    .run();
  return { ok: true, domain: view(record, env.CUSTOM_DOMAIN_CNAME) };
}

export async function markDomainUsed(env: Env, hostname: string): Promise<void> {
  const now = Date.now();
  await env.DOMAINS.prepare(
    `UPDATE custom_domains SET last_used_at = ?, updated_at = ?
      WHERE hostname = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
  )
    .bind(now, now, hostname, now - 60_000)
    .run();
}

export async function tunnelIdForDomain(env: Env, hostname: string): Promise<string | null> {
  const value: unknown = await env.DOMAINS.prepare(
    `SELECT tunnel_id FROM custom_domains
      WHERE hostname = ? AND status IN ('provisioning', 'active')`,
  )
    .bind(hostname)
    .first();
  return isRecord(value) && typeof value.tunnel_id === "string" ? value.tunnel_id : null;
}
