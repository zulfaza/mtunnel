import { useEffect, useState, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import { currentUser, listOrganizations, selectOrganization } from "../server/auth.js";

export function OrganizationSwitcher(): ReactNode {
  const [organizations, setOrganizations] = useState<readonly Schemas.OrganizationMembershipView[]>(
    [],
  );
  const [selected, setSelected] = useState("");

  useEffect(() => {
    void Promise.all([currentUser(), listOrganizations()])
      .then(([user, memberships]) => {
        setOrganizations(memberships);
        setSelected(user.organizationId);
      })
      .catch(() => undefined);
  }, []);

  const change = (organizationId: string): void => {
    const previous = selected;
    setSelected(organizationId);
    void selectOrganization({ data: { organizationId } })
      .then(() => window.location.reload())
      .catch(() => setSelected(previous));
  };

  if (organizations.length === 0) return null;

  return (
    <select
      aria-label="Organization"
      className="h-7 w-full min-w-0 border border-border bg-background px-2 text-xs text-foreground"
      onChange={(event) => change(event.target.value)}
      value={selected}
    >
      {organizations.map((organization) => (
        <option key={organization.id} value={organization.id}>
          {organization.name}
        </option>
      ))}
    </select>
  );
}
