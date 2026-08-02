import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { Previews, Schemas } from "@tunnel/core";
import { requireUser } from "./session.js";
import { runCore } from "./runtime.js";

export const listPreviews = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return runCore(
    Effect.gen(function* () {
      const previews = yield* Previews.Previews;
      return yield* previews.list(user.organizationId);
    }),
  );
});

export const updatePreview = createServerFn({ method: "POST" })
  .validator(
    (data: {
      readonly id: string;
      readonly visibility: Schemas.PreviewVisibility;
      readonly accessCode?: string;
    }) => data,
  )
  .handler(
    async ({
      data,
    }: {
      readonly data: {
        readonly id: string;
        readonly visibility: Schemas.PreviewVisibility;
        readonly accessCode?: string;
      };
    }) => {
      const user = await requireUser();
      if (data.id.length === 0) throw new Error("invalid_preview_id");
      if (!Schemas.PreviewVisibility.literals.includes(data.visibility))
        throw new Error("invalid_visibility");
      return runCore(
        Effect.gen(function* () {
          const previews = yield* Previews.Previews;
          return yield* previews.update({
            id: data.id,
            organizationId: user.organizationId,
            userId: user.userId,
            visibility: data.visibility,
            ...(data.accessCode === undefined ? {} : { accessCode: data.accessCode }),
          });
        }),
      );
    },
  );

export const deletePreview = createServerFn({ method: "POST" })
  .validator((data: { readonly id: string }) => data)
  .handler(async ({ data }: { readonly data: { readonly id: string } }) => {
    const user = await requireUser();
    if (data.id.length === 0) throw new Error("invalid_preview_id");
    return runCore(
      Effect.gen(function* () {
        const previews = yield* Previews.Previews;
        return yield* previews.delete({
          id: data.id,
          organizationId: user.organizationId,
          userId: user.userId,
        });
      }),
    );
  });

export const createPreview = createServerFn({ method: "POST" })
  .validator(
    (data: {
      readonly name: string;
      readonly files: readonly Schemas.PreviewFile[];
      readonly visibility?: Schemas.PreviewVisibility;
      readonly accessCode?: string;
      readonly repoHost?: string | null;
      readonly repoOrg?: string | null;
      readonly repoName?: string | null;
    }) => data,
  )
  .handler(
    async ({
      data,
    }: {
      readonly data: {
        readonly name: string;
        readonly files: readonly Schemas.PreviewFile[];
        readonly visibility?: Schemas.PreviewVisibility;
        readonly accessCode?: string;
        readonly repoHost?: string | null;
        readonly repoOrg?: string | null;
        readonly repoName?: string | null;
      };
    }) => {
      const user = await requireUser();
      const request = {
        name: data.name,
        files: data.files,
        ...(data.visibility === undefined ? {} : { visibility: data.visibility }),
        ...(data.accessCode === undefined ? {} : { accessCode: data.accessCode }),
        ...(data.repoHost === undefined ? {} : { repoHost: data.repoHost }),
        ...(data.repoOrg === undefined ? {} : { repoOrg: data.repoOrg }),
        ...(data.repoName === undefined ? {} : { repoName: data.repoName }),
      };
      return runCore(
        Effect.gen(function* () {
          const previews = yield* Previews.Previews;
          return yield* previews.create({
            organizationId: user.organizationId,
            userId: user.userId,
            request,
          });
        }),
      );
    },
  );
