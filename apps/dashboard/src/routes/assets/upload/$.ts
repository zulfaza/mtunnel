import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { Errors, Previews } from "@tunnel/core";
import { requireUser } from "../../../server/session.js";
import { runCore } from "../../../server/runtime.js";

export const Route = createFileRoute("/assets/upload/$")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const user = await requireUser();
        const body = request.body;
        if (body === null) return Response.json({ error: "bad_request" }, { status: 400 });
        const path = params._splat ?? "";
        if (path.length === 0) return Response.json({ error: "bad_request" }, { status: 400 });
        try {
          await runCore(
            Effect.gen(function* () {
              const previews = yield* Previews.Previews;
              yield* previews.upload({
                id: path.split("/")[0] ?? "",
                path: path.split("/").slice(1).join("/"),
                organizationId: user.organizationId,
                userId: user.userId,
                body,
                contentLength: request.headers.get("content-length"),
              });
            }),
          );
          return new Response(null, { status: 204 });
        } catch (error: unknown) {
          if (error instanceof Errors.NotFoundError)
            return Response.json({ error: "not_found" }, { status: 404 });
          if (error instanceof Errors.InvalidManifestError)
            return Response.json({ error: "invalid_manifest" }, { status: 500 });
          return Response.json({ error: "bad_request" }, { status: 400 });
        }
      },
    },
  },
});
