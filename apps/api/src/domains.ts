import { Effect, Schema } from "effect";
import { Domains, Errors, Schemas } from "@tunnel/core";
import { runCore } from "./runtime.js";
import type { Env } from "./env.js";

export type DomainStatus = Schemas.DomainStatus;
export type DomainView = Schemas.DomainView;
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

interface DomainInput {
  readonly hostname: string;
  readonly tunnelId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly maximumDomains: number | null;
}

const decodeDomainView = Schema.decodeUnknownOption(Schemas.DomainView);

function failure(error: unknown): DomainResult | null {
  if (error instanceof Errors.NotFoundError) return { ok: false, status: 404, error: "not_found" };
  if (error instanceof Errors.DomainConflictError)
    return (() => {
      const domain = decodeDomainView(error.domain);
      return {
        ok: false,
        status: 409,
        error: error.code,
        ...(error.message === undefined ? {} : { message: error.message }),
        ...(domain._tag === "Some" ? { domain: domain.value } : {}),
      };
    })();
  if (error instanceof Errors.DomainUpstreamError)
    return {
      ok: false,
      status: 502,
      error: error.code,
      ...(error.message === undefined ? {} : { message: error.message }),
    };
  if (error instanceof Errors.DomainsNotConfiguredError)
    return { ok: false, status: 503, error: "custom_domains_not_configured" };
  return null;
}

async function runDomain(
  env: Env,
  effect: Effect.Effect<
    { readonly domain: DomainView; readonly created?: true },
    unknown,
    import("@tunnel/core").Runtime.CoreServices
  >,
): Promise<DomainResult> {
  try {
    return { ok: true, ...(await runCore(env, effect)) };
  } catch (error: unknown) {
    return failure(error) ?? { ok: false, status: 502, error: "domain_storage_failed" };
  }
}

export async function addDomain(env: Env, input: DomainInput): Promise<DomainResult> {
  return runDomain(
    env,
    Effect.gen(function* () {
      const domains = yield* Domains.CustomDomains;
      return yield* domains.add(input);
    }),
  );
}

export async function verifyDomain(
  env: Env,
  hostname: string,
  organizationId: string,
  userId: string,
): Promise<DomainResult> {
  return runDomain(
    env,
    Effect.gen(function* () {
      const domains = yield* Domains.CustomDomains;
      return yield* domains.verify(hostname, organizationId, userId);
    }),
  );
}

export async function domainStatus(
  env: Env,
  hostname: string,
  organizationId: string,
  userId: string,
): Promise<DomainResult> {
  return runDomain(
    env,
    Effect.gen(function* () {
      const domains = yield* Domains.CustomDomains;
      return yield* domains.status(hostname, organizationId, userId);
    }),
  );
}

export async function listDomains(
  env: Env,
  organizationId: string,
  userId: string,
): Promise<DomainListView> {
  return runCore(
    env,
    Effect.gen(function* () {
      const domains = yield* Domains.CustomDomains;
      return yield* domains.list(organizationId, userId);
    }),
  );
}

export async function deleteDomain(
  env: Env,
  hostname: string,
  organizationId: string,
  userId: string,
): Promise<DomainResult | null> {
  try {
    return {
      ok: true,
      ...(await runCore(
        env,
        Effect.gen(function* () {
          const domains = yield* Domains.CustomDomains;
          return yield* domains.delete(hostname, organizationId, userId);
        }),
      )),
    };
  } catch (error: unknown) {
    if (error instanceof Errors.NotFoundError) return null;
    return failure(error) ?? { ok: false, status: 502, error: "domain_storage_failed" };
  }
}

export async function markDomainUsed(env: Env, hostname: string): Promise<void> {
  await runCore(
    env,
    Effect.gen(function* () {
      const domains = yield* Domains.CustomDomains;
      yield* domains.markUsed(hostname);
    }),
  );
}

export async function tunnelIdForDomain(env: Env, hostname: string): Promise<string | null> {
  return runCore(
    env,
    Effect.gen(function* () {
      const domains = yield* Domains.CustomDomains;
      return yield* domains.tunnelIdForDomain(hostname);
    }),
  );
}
