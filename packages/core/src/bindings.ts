import { Context, Effect, Layer } from "effect";
import type { TunnelStatusView } from "./schemas.js";

export interface RegistryStub {
  claimTunnel(tunnelId: string, organizationId: string, legacyUserId?: string): Promise<boolean>;
  ownsTunnel(tunnelId: string, organizationId: string, legacyUserId?: string): Promise<boolean>;
  organizationForTunnel(tunnelId: string): Promise<string | null>;
  acquireConnection(
    tunnelId: string,
    organizationId: string,
    connectionId: string,
    maximum: number | null,
  ): Promise<boolean>;
  releaseConnection(tunnelId: string, organizationId: string, connectionId: string): Promise<void>;
}

export interface TunnelStub {
  status(tunnelId: string): Promise<TunnelStatusView>;
  corsEnabled(): boolean | Promise<boolean>;
}

export class DomainsDatabase extends Context.Service<DomainsDatabase, D1Database>()(
  "@tunnel/core/bindings/DomainsDatabase",
) {}

export class PreviewBucket extends Context.Service<PreviewBucket, R2Bucket>()(
  "@tunnel/core/bindings/PreviewBucket",
) {}

export class TunnelRegistry extends Context.Service<
  TunnelRegistry,
  {
    readonly claimTunnel: (
      tunnelId: string,
      organizationId: string,
      legacyUserId?: string,
    ) => Effect.Effect<boolean>;
    readonly ownsTunnel: (
      tunnelId: string,
      organizationId: string,
      legacyUserId?: string,
    ) => Effect.Effect<boolean>;
    readonly organizationForTunnel: (tunnelId: string) => Effect.Effect<string | null>;
    readonly acquireConnection: (
      tunnelId: string,
      organizationId: string,
      connectionId: string,
      maximum: number | null,
    ) => Effect.Effect<boolean>;
    readonly releaseConnection: (
      tunnelId: string,
      organizationId: string,
      connectionId: string,
    ) => Effect.Effect<void>;
  }
>()("@tunnel/core/bindings/TunnelRegistry") {}

export class Tunnels extends Context.Service<
  Tunnels,
  {
    readonly status: (tunnelId: string) => Effect.Effect<TunnelStatusView>;
    readonly corsEnabled: (tunnelId: string) => Effect.Effect<boolean>;
  }
>()("@tunnel/core/bindings/Tunnels") {}

export interface CoreBindings {
  readonly domains: D1Database;
  readonly previews: R2Bucket;
  readonly registry: () => RegistryStub;
  readonly tunnels: (tunnelId: string) => TunnelStub;
}

export function makeBindingsLayer(
  bindings: CoreBindings,
): Layer.Layer<DomainsDatabase | PreviewBucket | TunnelRegistry | Tunnels> {
  return Layer.mergeAll(
    Layer.succeed(DomainsDatabase, bindings.domains),
    Layer.succeed(PreviewBucket, bindings.previews),
    Layer.succeed(TunnelRegistry, {
      claimTunnel: (tunnelId, organizationId, legacyUserId) =>
        Effect.promise(() =>
          bindings.registry().claimTunnel(tunnelId, organizationId, legacyUserId),
        ),
      ownsTunnel: (tunnelId, organizationId, legacyUserId) =>
        Effect.promise(() =>
          bindings.registry().ownsTunnel(tunnelId, organizationId, legacyUserId),
        ),
      organizationForTunnel: (tunnelId) =>
        Effect.promise(() => bindings.registry().organizationForTunnel(tunnelId)),
      acquireConnection: (tunnelId, organizationId, connectionId, maximum) =>
        Effect.promise(() =>
          bindings.registry().acquireConnection(tunnelId, organizationId, connectionId, maximum),
        ),
      releaseConnection: (tunnelId, organizationId, connectionId) =>
        Effect.promise(() =>
          bindings.registry().releaseConnection(tunnelId, organizationId, connectionId),
        ),
    }),
    Layer.succeed(Tunnels, {
      status: (tunnelId) => Effect.promise(() => bindings.tunnels(tunnelId).status(tunnelId)),
      corsEnabled: (tunnelId) =>
        Effect.promise(() => Promise.resolve(bindings.tunnels(tunnelId).corsEnabled())),
    }),
  );
}
