import { useEffect, useState, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import {
  createOrganization,
  currentUser,
  listOrganizations,
  selectOrganization,
} from "../server/auth.js";

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
    setSelected(organizationId);
    void selectOrganization({ data: { organizationId } }).catch(() => undefined);
  };

  const create = (): void => {
    const name = window.prompt("Organization name");
    if (name === null || name.trim() === "") return;
    void createOrganization({ data: { name } })
      .then((organization) => {
        setOrganizations((current) => [...current, organization]);
        setSelected(organization.id);
      })
      .catch(() => undefined);
  };

  if (organizations.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label="Organization"
        className="h-7 max-w-40 border border-border bg-background px-2 text-xs text-foreground"
        onChange={(event) => change(event.target.value)}
        value={selected}
      >
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
      <button
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={create}
        type="button"
      >
        +
      </button>
    </span>
  );
}
