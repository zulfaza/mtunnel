import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DomainsPage } from "../components/domains.js";
import { listDomains } from "../server/domains.js";

export const Route = createFileRoute("/domains")({
  loader: async () => {
    try {
      return await listDomains();
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  component: DomainsRoute,
});

function DomainsRoute(): ReactNode {
  const data = Route.useLoaderData();
  return <DomainsPage initialDomains={data.domains} />;
}
