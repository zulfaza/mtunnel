import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AssetsPage } from "../components/assets.js";
import { beginLogin, currentUser } from "../server/auth.js";
import { listPreviews } from "../server/previews.js";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      await currentUser();
    } catch (cause) {
      if (!isSignedOut(cause)) throw cause;
      const login = await beginLogin({ data: { screenHint: "sign-in" } });
      throw redirect({ href: login.url });
    }
    const previews = await listPreviews();
    return { previews };
  },
  component: IndexPage,
});

function isSignedOut(cause: unknown): boolean {
  return cause instanceof Error && cause.message === "signed_out";
}

function IndexPage(): ReactNode {
  const data = Route.useLoaderData();
  return <AssetsPage initialPreviews={data.previews} />;
}
