import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { Errors, Previews, Schemas } from "@tunnel/core";
import { requireUser } from "./session.js";
import { runCore } from "./runtime.js";

export const listPreviews = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const user = await requireUser();
    return await runCore(
      Effect.gen(function* () {
        const previews = yield* Previews.Previews;
        return yield* previews.list(user.organizationId);
      }),
    );
  } catch (cause) {
    console.error("dashboard.list_previews_failed", cause);
    throw cause;
  }
});

export const previewVersions = createServerFn({ method: "GET" })
  .validator((data: { readonly documentId: string }) => data)
  .handler(async ({ data }: { readonly data: { readonly documentId: string } }) => {
    const user = await requireUser();
    if (data.documentId.length === 0) throw new Error("invalid_document_id");
    try {
      return await runCore(
        Effect.gen(function* () {
          const previews = yield* Previews.Previews;
          return yield* previews.versions({
            documentId: data.documentId,
            organizationId: user.organizationId,
          });
        }),
      );
    } catch (cause) {
      if (cause instanceof Errors.NotFoundError) return [];
      throw cause;
    }
  });

export const previewAccess = createServerFn({ method: "GET" })
  .validator((data: { readonly previewId: string }) => data)
  .handler(async ({ data }: { readonly data: { readonly previewId: string } }) => {
    const user = await requireUser();
    if (data.previewId.length === 0) throw new Error("invalid_preview_id");
    return runCore(
      Effect.gen(function* () {
        const previews = yield* Previews.Previews;
        return yield* previews.access({
          previewId: data.previewId,
          organizationId: user.organizationId,
        });
      }),
    );
  });

export const deletePreviewAccessCode = createServerFn({ method: "POST" })
  .validator((data: { readonly previewId: string; readonly id: string }) => data)
  .handler(
    async ({ data }: { readonly data: { readonly previewId: string; readonly id: string } }) => {
      const user = await requireUser();
      if (data.previewId.length === 0 || data.id.length === 0) throw new Error("invalid_access_id");
      return runCore(
        Effect.gen(function* () {
          const previews = yield* Previews.Previews;
          return yield* previews.deleteAccessCode({
            previewId: data.previewId,
            id: data.id,
            organizationId: user.organizationId,
          });
        }),
      );
    },
  );

export const revokePreviewAccessSession = createServerFn({ method: "POST" })
  .validator((data: { readonly previewId: string; readonly id: string }) => data)
  .handler(
    async ({ data }: { readonly data: { readonly previewId: string; readonly id: string } }) => {
      const user = await requireUser();
      if (data.previewId.length === 0 || data.id.length === 0) throw new Error("invalid_access_id");
      return runCore(
        Effect.gen(function* () {
          const previews = yield* Previews.Previews;
          return yield* previews.revokeAccessSession({
            previewId: data.previewId,
            id: data.id,
            organizationId: user.organizationId,
          });
        }),
      );
    },
  );

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
      readonly group?: string;
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
        readonly group?: string;
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
        ...(data.group === undefined ? {} : { group: data.group }),
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
