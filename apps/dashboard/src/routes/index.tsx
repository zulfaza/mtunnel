import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AssetsPage } from "../components/assets.js";
import { currentUser } from "../server/auth.js";
import { listPreviews } from "../server/previews.js";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      const [user, previews] = await Promise.all([currentUser(), listPreviews()]);
      return { email: user.email, previews };
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  component: IndexPage,
});

function IndexPage(): ReactNode {
  const data = Route.useLoaderData();
  return <AssetsPage email={data.email} initialPreviews={data.previews} />;
}
