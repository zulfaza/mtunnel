import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import {
  createOrganization,
  currentUser,
  listOrganizations,
  selectOrganization,
} from "../server/auth.js";
import { Button } from "./ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";

type CreateOrganizationState =
  | { readonly status: "idle" }
  | { readonly status: "editing"; readonly name: string }
  | { readonly status: "creating"; readonly name: string };

export function OrganizationSwitcher(): ReactNode {
  const [organizations, setOrganizations] = useState<readonly Schemas.OrganizationMembershipView[]>(
    [],
  );
  const [selected, setSelected] = useState("");
  const [createState, setCreateState] = useState<CreateOrganizationState>({ status: "idle" });

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

  const create = (event: FormEvent): void => {
    event.preventDefault();
    if (createState.status !== "editing" || createState.name.trim() === "") return;
    const name = createState.name.trim();
    setCreateState({ status: "creating", name });
    void createOrganization({ data: { name } })
      .then((organization) => {
        setOrganizations((current) => [...current, organization]);
        setSelected(organization.id);
        setCreateState({ status: "idle" });
      })
      .catch(() => setCreateState({ status: "editing", name }));
  };

  if (organizations.length === 0) return null;
  const creating = createState.status === "creating";
  const name = createState.status === "idle" ? "" : createState.name;

  return (
    <>
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
          onClick={() => setCreateState({ status: "editing", name: "" })}
          type="button"
        >
          +
        </button>
      </span>
      <Dialog
        onOpenChange={(open) => !open && !creating && setCreateState({ status: "idle" })}
        open={createState.status !== "idle"}
      >
        <DialogContent>
          <form onSubmit={create}>
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
              <DialogDescription>Add an organization to switch to.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex flex-col gap-2">
              <Label htmlFor="organization-name">Organization name</Label>
              <Input
                autoFocus
                disabled={creating}
                id="organization-name"
                onChange={(event) =>
                  setCreateState({ status: "editing", name: event.target.value })
                }
                required
                value={name}
              />
            </div>
            <DialogFooter className="mt-4">
              <Button
                disabled={creating}
                onClick={() => setCreateState({ status: "idle" })}
                type="button"
              >
                Cancel
              </Button>
              <Button disabled={creating || name.trim() === ""} type="submit" variant="primary">
                {creating ? "Creating…" : "Create organization"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
