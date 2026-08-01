import * as Schema from "effect/Schema";

const tunnelIdPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u;
const hostnamePattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const previewPathPattern = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export const TunnelId = Schema.String.pipe(
  Schema.check(Schema.isPattern(tunnelIdPattern)),
  Schema.brand("TunnelId"),
);
export type TunnelId = Schema.Schema.Type<typeof TunnelId>;

export function isValidTunnelId(value: string): value is TunnelId {
  return tunnelIdPattern.test(value);
}

export const Hostname = Schema.String.pipe(Schema.check(Schema.isPattern(hostnamePattern)));

export function isValidHostname(value: string): boolean {
  return hostnamePattern.test(value);
}

export const PreviewVisibility = Schema.Literals(["public", "private", "code"]);
export type PreviewVisibility = Schema.Schema.Type<typeof PreviewVisibility>;

export const AccessCode = Schema.String.pipe(
  Schema.check(Schema.isMinLength(4)),
  Schema.check(Schema.isMaxLength(128)),
);
export type AccessCode = Schema.Schema.Type<typeof AccessCode>;

export const PreviewFile = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isPattern(previewPathPattern))),
  size: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  contentType: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(255)),
  ),
  sha256: Schema.String.pipe(Schema.check(Schema.isPattern(sha256Pattern))),
});
export type PreviewFile = Schema.Schema.Type<typeof PreviewFile>;

export const PreviewView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  totalBytes: Schema.Number,
  fileCount: Schema.Number,
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
  visibility: PreviewVisibility,
});
export type PreviewView = Schema.Schema.Type<typeof PreviewView>;

export const DomainStatus = Schema.Literals(["pending_dns", "provisioning", "active", "failed"]);
export type DomainStatus = Schema.Schema.Type<typeof DomainStatus>;

const DnsRecord = Schema.Struct({
  type: Schema.Literals(["CNAME", "TXT"]),
  name: Schema.String,
  value: Schema.String,
});

export const DomainView = Schema.Struct({
  hostname: Schema.String,
  tunnelId: Schema.String,
  status: DomainStatus,
  cname: DnsRecord,
  verification: DnsRecord,
  error: Schema.optionalKey(Schema.String),
  lastUsedAt: Schema.NullOr(Schema.String),
});
export type DomainView = Schema.Schema.Type<typeof DomainView>;

export const TunnelStatusView = Schema.Struct({
  tunnelId: Schema.String,
  connected: Schema.Boolean,
  connectedAt: Schema.optionalKey(Schema.Number),
  pendingRequests: Schema.Number,
  lastHeartbeatAt: Schema.optionalKey(Schema.Number),
});
export type TunnelStatusView = Schema.Schema.Type<typeof TunnelStatusView>;

export const OrganizationMembershipView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.optionalKey(Schema.String),
});
export type OrganizationMembershipView = Schema.Schema.Type<typeof OrganizationMembershipView>;

export const OrganizationLimits = Schema.Struct({
  maximumCustomDomains: Schema.NullOr(Schema.Number),
  maximumActiveTunnels: Schema.NullOr(Schema.Number),
  idleTimeoutSeconds: Schema.Number,
  maximumTunnelLifetimeSeconds: Schema.Number,
  maximumPreviews: Schema.NullOr(Schema.Number),
  maximumPreviewBytes: Schema.NullOr(Schema.Number),
  maximumPreviewFileBytes: Schema.Number,
  maximumPreviewFiles: Schema.NullOr(Schema.Number),
  previewTTLSeconds: Schema.Number,
});
export type OrganizationLimits = Schema.Schema.Type<typeof OrganizationLimits>;

export const TokenRequest = Schema.Struct({ tunnelId: TunnelId });
export type TokenRequest = Schema.Schema.Type<typeof TokenRequest>;

export const DomainAddRequest = Schema.Struct({
  hostname: Schema.String,
  tunnelId: TunnelId,
});
export type DomainAddRequest = Schema.Schema.Type<typeof DomainAddRequest>;

export const OrganizationCreateRequest = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(100)),
  ),
});
export type OrganizationCreateRequest = Schema.Schema.Type<typeof OrganizationCreateRequest>;

export const PreviewCreateRequest = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(255)),
  ),
  files: Schema.Array(PreviewFile),
  visibility: Schema.optionalKey(PreviewVisibility),
  accessCode: Schema.optionalKey(AccessCode),
});
export type PreviewCreateRequest = Schema.Schema.Type<typeof PreviewCreateRequest>;

export const PreviewUpdateRequest = Schema.Struct({
  visibility: PreviewVisibility,
  accessCode: Schema.optionalKey(AccessCode),
});
export type PreviewUpdateRequest = Schema.Schema.Type<typeof PreviewUpdateRequest>;
