import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { Bindings, Schemas } from "@tunnel/core";
import { requireUser } from "./session.js";
import { runCore } from "./runtime.js";

export const tunnelStatus = createServerFn({ method: "GET" })
  .validator((data: { readonly tunnelId: string }) => data)
  .handler(async ({ data }) => {
    if (!Schemas.isValidTunnelId(data.tunnelId)) throw new Error("invalid_tunnel_id");
    const user = await requireUser();
    return getTunnelStatus(data.tunnelId, user.organizationId, user.userId);
  });

async function getTunnelStatus(tunnelId: string, organizationId: string, userId: string) {
  return runCore(
    Effect.gen(function* () {
      const registry = yield* Bindings.TunnelRegistry;
      if (!(yield* registry.ownsTunnel(tunnelId, organizationId, userId)))
        throw new Error("tunnel_not_found");
      const tunnels = yield* Bindings.Tunnels;
      return yield* tunnels.status(tunnelId);
    }),
  );
}
