import type { Env } from "./env.js";

export type DomainStatus = "pending_dns" | "provisioning" | "active" | "failed";

export interface DomainView {
  readonly hostname: string;
  readonly tunnelId: string;
  readonly status: DomainStatus;
  readonly cname: { readonly type: "CNAME"; readonly name: string; readonly value: string };
  readonly verification: { readonly type: "TXT"; readonly name: string; readonly value: string };
  readonly error?: string;
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
  readonly ownerId: string;
  readonly verificationToken: string;
  readonly status: DomainStatus;
  readonly cloudflareHostnameId: string | null;
  readonly error: string | null;
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
    typeof value.owner_id !== "string" ||
    typeof value.verification_token !== "string" ||
    !isDomainStatus(value.status) ||
    (value.cloudflare_hostname_id !== null && typeof value.cloudflare_hostname_id !== "string") ||
    (value.error !== null && typeof value.error !== "string")
  )
    return null;
  return {
    hostname: value.hostname,
    tunnelId: value.tunnel_id,
    ownerId: value.owner_id,
    verificationToken: value.verification_token,
    status: value.status,
    cloudflareHostnameId: value.cloudflare_hostname_id,
    error: value.error,
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
  };
  return record.error === null ? result : { ...result, error: record.error };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function findDomain(env: Env, hostname: string): Promise<DomainRecord | null> {
  const value: unknown = await env.DOMAINS.prepare(
    `SELECT hostname, tunnel_id, owner_id, verification_token, status,
            cloudflare_hostname_id, error
       FROM custom_domains WHERE hostname = ?`,
  )
    .bind(hostname)
    .first();
  return parseDomainRecord(value);
}

export async function addDomain(
  env: Env,
  input: { readonly hostname: string; readonly tunnelId: string; readonly ownerId: string },
): Promise<DomainResult> {
  const claimed = await env.REGISTRY.getByName("global").claimTunnel(input.tunnelId, input.ownerId);
  if (!claimed) return { ok: false, status: 409, error: "domain_or_tunnel_taken" };
  const now = Date.now();
  const inserted = await env.DOMAINS.prepare(
    `INSERT INTO custom_domains
       (hostname, tunnel_id, owner_id, verification_token, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending_dns', ?, ?)
     ON CONFLICT(hostname) DO NOTHING`,
  )
    .bind(input.hostname, input.tunnelId, input.ownerId, randomToken(), now, now)
    .run();
  const record = await findDomain(env, input.hostname);
  if (record === null) return { ok: false, status: 502, error: "domain_storage_failed" };
  if (record.ownerId !== input.ownerId || record.tunnelId !== input.tunnelId)
    return { ok: false, status: 409, error: "domain_or_tunnel_taken" };
  return inserted.meta.changes > 0
    ? { ok: true, domain: view(record, env.TUNNEL_DOMAIN), created: true }
    : { ok: true, domain: view(record, env.TUNNEL_DOMAIN) };
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
      WHERE hostname = ? AND owner_id = ?`,
  )
    .bind(status, hostnameId, Date.now(), record.hostname, record.ownerId)
    .run();
  return { ...record, status, cloudflareHostnameId: hostnameId, error: null };
}

async function saveFailure(env: Env, record: DomainRecord, message: string): Promise<void> {
  await env.DOMAINS.prepare(
    `UPDATE custom_domains SET status = 'failed', error = ?, updated_at = ?
      WHERE hostname = ? AND owner_id = ?`,
  )
    .bind(message, Date.now(), record.hostname, record.ownerId)
    .run();
}

export async function verifyDomain(
  env: Env,
  hostname: string,
  ownerId: string,
): Promise<DomainResult> {
  const record = await findDomain(env, hostname);
  if (record === null || record.ownerId !== ownerId)
    return { ok: false, status: 404, error: "not_found" };
  if (record.status === "active" || record.status === "provisioning")
    return { ok: true, domain: view(record, env.TUNNEL_DOMAIN) };
  if (!(await hasVerificationRecord(record))) {
    return {
      ok: false,
      status: 409,
      error: "dns_verification_pending",
      message: "TXT verification record not found",
      domain: view(record, env.TUNNEL_DOMAIN),
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
      return { ok: true, domain: view(saved, env.TUNNEL_DOMAIN) };
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
  return { ok: true, domain: view(saved, env.TUNNEL_DOMAIN) };
}

export async function domainStatus(
  env: Env,
  hostname: string,
  ownerId: string,
): Promise<DomainResult> {
  const record = await findDomain(env, hostname);
  if (record === null || record.ownerId !== ownerId)
    return { ok: false, status: 404, error: "not_found" };
  if (
    record.status !== "provisioning" ||
    record.cloudflareHostnameId === null ||
    env.CLOUDFLARE_API_TOKEN === undefined ||
    env.CLOUDFLARE_ZONE_ID === undefined
  )
    return { ok: true, domain: view(record, env.TUNNEL_DOMAIN) };
  const upstream = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${record.cloudflareHostnameId}`,
    { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
  );
  if (!upstream.ok) return { ok: true, domain: view(record, env.TUNNEL_DOMAIN) };
  const value: unknown = await upstream.json().catch((): null => null);
  const provisioned = cloudflareHostname(value);
  if (provisioned === null || !provisioned.active)
    return { ok: true, domain: view(record, env.TUNNEL_DOMAIN) };
  const saved = await saveProvisioningResult(env, record, provisioned.id, "active");
  return { ok: true, domain: view(saved, env.TUNNEL_DOMAIN) };
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
