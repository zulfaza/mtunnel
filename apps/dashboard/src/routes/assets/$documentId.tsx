import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PreviewDetailPage } from "../../components/preview-detail.js";
import { previewVersions } from "../../server/previews.js";

export const Route = createFileRoute("/assets/$documentId")({
  loader: async ({ params }) => {
    try {
      const versions = await previewVersions({ data: { documentId: params.documentId } });
      if (versions.length === 0) throw notFound();
      return versions;
    } catch (cause) {
      if (cause instanceof Error && cause.message === "signed_out")
        throw redirect({ to: "/login" });
      throw cause;
    }
  },
  component: PreviewDetailsRoute,
});

function PreviewDetailsRoute(): ReactNode {
  const versions = Route.useLoaderData();
  return <PreviewDetailPage versions={versions} />;
}
