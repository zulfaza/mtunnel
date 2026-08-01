import { Layer, ManagedRuntime } from "effect";
import { accessLimitsLayer, AccessLimits } from "./access.js";
import { analyticsLayer, Analytics } from "./analytics.js";
import { authenticationLayer, Authentication } from "./auth.js";
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
import { customDomainsLayer, CustomDomains } from "./domains.js";
import { Organizations, organizationsLayer } from "./organizations.js";
import { previewsLayer, Previews } from "./previews.js";
import { Workos, workosLayer } from "./workos.js";

export type CoreServices =
  | DomainsDatabase
  | PreviewBucket
  | TunnelRegistry
  | Tunnels
  | CoreConfig
  | AccessLimits
  | Workos
  | Organizations
  | Authentication
  | CustomDomains
  | Previews
  | Analytics;

export const makeCoreLayer = (bindings: CoreBindings, config: CoreConfigShape) => {
  const foundation = Layer.mergeAll(makeBindingsLayer(bindings), Layer.succeed(CoreConfig, config));
  const access = accessLimitsLayer.pipe(Layer.provideMerge(foundation));
  const workos = workosLayer.pipe(Layer.provideMerge(foundation));
  const organizations = organizationsLayer.pipe(Layer.provideMerge(workos));
  const authentication = authenticationLayer.pipe(Layer.provideMerge(organizations));
  const domains = customDomainsLayer.pipe(Layer.provideMerge(foundation));
  const previews = previewsLayer.pipe(Layer.provideMerge(access));
  const analytics = analyticsLayer.pipe(Layer.provideMerge(foundation));
  return Layer.mergeAll(authentication, domains, previews, analytics);
};

export function makeCoreRuntime(bindings: CoreBindings, config: CoreConfigShape) {
  const layer = makeCoreLayer(bindings, config);
  let runtime: ManagedRuntime.ManagedRuntime<CoreServices, never> | undefined;
  const getRuntime = () => {
    if (runtime === undefined) runtime = ManagedRuntime.make(layer);
    return runtime;
  };
  return {
    runPromise: <A, E>(effect: import("effect").Effect.Effect<A, E, CoreServices>) =>
      getRuntime().runPromise(effect),
    runPromiseExit: <A, E>(effect: import("effect").Effect.Effect<A, E, CoreServices>) =>
      getRuntime().runPromiseExit(effect),
  };
}
