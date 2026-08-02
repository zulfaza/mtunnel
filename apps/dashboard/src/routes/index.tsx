import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AssetsPage } from "../components/assets.js";
import { beginLogin, currentUser } from "../server/auth.js";
import { listPreviews } from "../server/previews.js";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      const [, previews] = await Promise.all([currentUser(), listPreviews()]);
      return { previews };
    } catch {
      const login = await beginLogin({ data: { screenHint: "sign-in" } });
      throw redirect({ href: login.url });
    }
  },
  component: IndexPage,
});

function IndexPage(): ReactNode {
  const data = Route.useLoaderData();
  return <AssetsPage initialPreviews={data.previews} />;
}
