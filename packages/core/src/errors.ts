import * as Schema from "effect/Schema";

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()(
  "UnauthorizedError",
  {},
) {
  readonly status = 401;
  readonly code = "unauthorized";
}

export class ForbiddenError extends Schema.TaggedErrorClass<ForbiddenError>()(
  "ForbiddenError",
  {},
) {
  readonly status = 403;
  readonly code = "forbidden";
}

export class OrganizationUnavailableError extends Schema.TaggedErrorClass<OrganizationUnavailableError>()(
  "OrganizationUnavailableError",
  {},
) {
  readonly status = 503;
  readonly code = "organization_unavailable";
}

export class BadRequestError extends Schema.TaggedErrorClass<BadRequestError>()(
  "BadRequestError",
  {},
) {
  readonly status = 400;
  readonly code = "bad_request";
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("NotFoundError", {}) {
  readonly status = 404;
  readonly code = "not_found";
}

export class RateLimitedError extends Schema.TaggedErrorClass<RateLimitedError>()(
  "RateLimitedError",
  {},
) {
  readonly status = 429;
  readonly code = "rate_limited";
}

export class TunnelNameTakenError extends Schema.TaggedErrorClass<TunnelNameTakenError>()(
  "TunnelNameTakenError",
  {},
) {
  readonly status = 409;
  readonly code = "tunnel_name_taken";
}

export class ActiveTunnelLimitError extends Schema.TaggedErrorClass<ActiveTunnelLimitError>()(
  "ActiveTunnelLimitError",
  {},
) {
  readonly status = 429;
  readonly code = "active_tunnel_limit_reached";
}

export class UpgradeRequiredError extends Schema.TaggedErrorClass<UpgradeRequiredError>()(
  "UpgradeRequiredError",
  {},
) {
  readonly status = 426;
  readonly code = "upgrade_required";
}

export class MisconfiguredError extends Schema.TaggedErrorClass<MisconfiguredError>()(
  "MisconfiguredError",
  {},
) {
  readonly status = 500;
  readonly code = "server_misconfigured";
}

const domainConflictCodes = [
  "custom_domain_limit_reached",
  "domain_or_tunnel_taken",
  "dns_verification_pending",
] as const;
export const DomainConflictCode = Schema.Literals(domainConflictCodes);
export type DomainConflictCode = Schema.Schema.Type<typeof DomainConflictCode>;

export class DomainConflictError extends Schema.TaggedErrorClass<DomainConflictError>()(
  "DomainConflictError",
  {
    code: DomainConflictCode,
    message: Schema.optionalKey(Schema.String),
    domain: Schema.optionalKey(Schema.Unknown),
  },
) {
  readonly status = 409;
}

const domainUpstreamCodes = [
  "custom_domain_provision_failed",
  "custom_domain_delete_failed",
  "domain_storage_failed",
] as const;
export const DomainUpstreamCode = Schema.Literals(domainUpstreamCodes);
export type DomainUpstreamCode = Schema.Schema.Type<typeof DomainUpstreamCode>;

export class DomainUpstreamError extends Schema.TaggedErrorClass<DomainUpstreamError>()(
  "DomainUpstreamError",
  {
    code: DomainUpstreamCode,
    message: Schema.optionalKey(Schema.String),
  },
) {
  readonly status = 502;
}

export class DomainsNotConfiguredError extends Schema.TaggedErrorClass<DomainsNotConfiguredError>()(
  "DomainsNotConfiguredError",
  {},
) {
  readonly status = 503;
  readonly code = "custom_domains_not_configured";
}

export class PreviewLimitError extends Schema.TaggedErrorClass<PreviewLimitError>()(
  "PreviewLimitError",
  {},
) {
  readonly status = 413;
  readonly code = "preview_limit_exceeded";
}

export class InvalidManifestError extends Schema.TaggedErrorClass<InvalidManifestError>()(
  "InvalidManifestError",
  {},
) {
  readonly status = 500;
  readonly code = "invalid_manifest";
}

export class OrganizationCreateError extends Schema.TaggedErrorClass<OrganizationCreateError>()(
  "OrganizationCreateError",
  {},
) {
  readonly status = 502;
  readonly code = "organization_create_failed";
}

export type CoreError =
  | UnauthorizedError
  | ForbiddenError
  | OrganizationUnavailableError
  | BadRequestError
  | NotFoundError
  | RateLimitedError
  | TunnelNameTakenError
  | ActiveTunnelLimitError
  | UpgradeRequiredError
  | MisconfiguredError
  | DomainConflictError
  | DomainUpstreamError
  | DomainsNotConfiguredError
  | PreviewLimitError
  | InvalidManifestError
  | OrganizationCreateError;

export interface ErrorResponseParts {
  readonly status: number;
  readonly error: string;
  readonly message?: string;
  readonly domain?: unknown;
}

export function errorToResponseParts(error: CoreError): ErrorResponseParts {
  return {
    status: error.status,
    error: error.code,
    ...(error instanceof DomainConflictError && error.message !== undefined
      ? { message: error.message }
      : {}),
    ...(error instanceof DomainConflictError && error.domain !== undefined
      ? { domain: error.domain }
      : {}),
    ...(error instanceof DomainUpstreamError && error.message !== undefined
      ? { message: error.message }
      : {}),
  };
}
