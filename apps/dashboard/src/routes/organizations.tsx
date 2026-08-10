import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { OrganizationsPage } from "../components/organizations.js";
import { organizationSettings } from "../server/auth.js";

export const Route = createFileRoute("/organizations")({
  loader: async () => {
    try {
      return await organizationSettings();
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  component: OrganizationsRoute,
});

function OrganizationsRoute(): ReactNode {
  const data = Route.useLoaderData();
  return <OrganizationsPage initialSettings={data} />;
}
