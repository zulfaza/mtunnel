import { Layer, ManagedRuntime } from "effect";
import type { CoreConfigShape } from "./config.js";
import { CoreConfig } from "./config.js";
import {
  DomainsDatabase,
  makeBindingsLayer,
  PreviewBucket,
  TunnelRegistry,
  Tunnels,
  type CoreBindings,
} from "./bindings.js";

export const makeCoreLayer = (bindings: CoreBindings, config: CoreConfigShape) =>
  Layer.mergeAll(makeBindingsLayer(bindings), Layer.succeed(CoreConfig, config));

export function makeCoreRuntime(bindings: CoreBindings, config: CoreConfigShape) {
  const layer = makeCoreLayer(bindings, config);
  let runtime:
    | ManagedRuntime.ManagedRuntime<
        DomainsDatabase | PreviewBucket | TunnelRegistry | Tunnels | CoreConfig,
        never
      >
    | undefined;
  const getRuntime = () => {
    if (runtime === undefined) runtime = ManagedRuntime.make(layer);
    return runtime;
  };
  return {
    runPromise: <A, E>(
      effect: import("effect").Effect.Effect<
        A,
        E,
        DomainsDatabase | PreviewBucket | TunnelRegistry | Tunnels | CoreConfig
      >,
    ) => getRuntime().runPromise(effect),
    runPromiseExit: <A, E>(
      effect: import("effect").Effect.Effect<
        A,
        E,
        DomainsDatabase | PreviewBucket | TunnelRegistry | Tunnels | CoreConfig
      >,
    ) => getRuntime().runPromiseExit(effect),
  };
}
