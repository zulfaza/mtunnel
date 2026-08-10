import { useNavigate } from "@tanstack/react-router";
import { LogOut, UserMinus, UserPlus } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import {
  createOrganization,
  inviteOrganizationMember,
  leaveOrganization,
  removeOrganizationMember,
  renameOrganization,
} from "../server/auth.js";
import { SectionHeading, Shell } from "./shell.js";
import { ActionMenu, ActionMenuItem } from "./ui/action-menu.js";
import { Badge } from "./ui/badge.js";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.js";

type Organization = Schemas.OrganizationMembershipView;
type Member = Schemas.OrganizationMemberView;
type Settings = Schemas.OrganizationSettingsView & { readonly currentUserId: string };
type SubmissionStatus = "ready" | "submitting";
type OrganizationDialog =
  | { readonly kind: "closed" }
  | {
      readonly kind: "create";
      readonly status: SubmissionStatus;
      readonly name: string;
      readonly error: string | null;
    }
  | {
      readonly kind: "invite";
      readonly status: SubmissionStatus;
      readonly email: string;
      readonly error: string | null;
    }
  | {
      readonly kind: "remove";
      readonly status: SubmissionStatus;
      readonly member: Member;
      readonly error: string | null;
    }
  | {
      readonly kind: "leave";
      readonly status: SubmissionStatus;
      readonly error: string | null;
    };

function errorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "Request failed.";
  switch (cause.message) {
    case "organization_name_invalid":
      return "Enter an organization name between 1 and 100 characters.";
    case "organization_email_invalid":
      return "Enter a valid email address.";
    case "organization_forbidden":
      return "You no longer have access to this organization.";
    case "organization_create_failed":
      return "Could not create the organization.";
    case "organization_update_failed":
      return "Could not update the organization.";
    case "organization_invite_failed":
      return "Could not send the invitation.";
    case "organization_member_remove_failed":
      return "Could not remove the member.";
    case "organization_leave_failed":
      return "Could not leave the organization.";
    case "last_organization":
      return "Create or join another organization before leaving this one.";
    default:
      return "Request failed.";
  }
}

export function OrganizationsPage({
  initialSettings,
}: {
  readonly initialSettings: Settings;
}): ReactNode {
  const navigate = useNavigate();
  const [organization, setOrganization] = useState<Organization>(initialSettings.organization);
  const [members, setMembers] = useState<readonly Member[]>(initialSettings.members);
  const [name, setName] = useState(initialSettings.organization.name);
  const [savingName, setSavingName] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OrganizationDialog>({ kind: "closed" });

  const failPage = (cause: unknown): void => {
    if (cause instanceof Error && cause.message === "signed_out") {
      void navigate({ to: "/login" });
      return;
    }
    setPageError(errorMessage(cause));
  };

  const failDialog = (cause: unknown): void => {
    if (cause instanceof Error && cause.message === "signed_out") {
      void navigate({ to: "/login" });
      return;
    }
    setDialog((current) =>
      current.kind === "closed"
        ? current
        : { ...current, status: "ready", error: errorMessage(cause) },
    );
  };

  const saveName = (event: FormEvent): void => {
    event.preventDefault();
    const nextName = name.trim();
    if (nextName === "" || nextName === organization.name) return;
    setSavingName(true);
    setPageError(null);
    setNotice(null);
    void renameOrganization({ data: { organizationId: organization.id, name: nextName } })
      .then((updated) => {
        setOrganization(updated);
        setName(updated.name);
        setNotice("Organization name saved.");
      })
      .catch(failPage)
      .finally(() => setSavingName(false));
  };

  const create = (): void => {
    if (dialog.kind !== "create") return;
    const nextName = dialog.name.trim();
    if (nextName === "") return;
    setDialog({ ...dialog, status: "submitting", error: null });
    void createOrganization({ data: { name: nextName } })
      .then(() => window.location.reload())
      .catch(failDialog);
  };

  const invite = (): void => {
    if (dialog.kind !== "invite") return;
    const email = dialog.email.trim().toLowerCase();
    if (email === "") return;
    setDialog({ ...dialog, status: "submitting", error: null });
    void inviteOrganizationMember({ data: { organizationId: organization.id, email } })
      .then((invitation) => {
        setDialog({ kind: "closed" });
        setNotice(`Invitation sent to ${invitation.email}.`);
      })
      .catch(failDialog);
  };

  const remove = (): void => {
    if (dialog.kind !== "remove") return;
    const member = dialog.member;
    setDialog({ ...dialog, status: "submitting", error: null });
    void removeOrganizationMember({
      data: { organizationId: organization.id, membershipId: member.membershipId },
    })
      .then(() => {
        setMembers((current) =>
          current.filter((candidate) => candidate.membershipId !== member.membershipId),
        );
        setDialog({ kind: "closed" });
        setNotice(`${member.email} removed.`);
      })
      .catch(failDialog);
  };

  const leave = (): void => {
    if (dialog.kind !== "leave") return;
    setDialog({ ...dialog, status: "submitting", error: null });
    void leaveOrganization({ data: { organizationId: organization.id } })
      .then(() => window.location.reload())
      .catch(failDialog);
  };

  return (
    <Shell>
      <section className="flex-1 px-5 py-8 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <SectionHeading>Organization</SectionHeading>
          <Button
            onClick={() => setDialog({ kind: "create", status: "ready", name: "", error: null })}
            type="button"
            variant="primary"
          >
            + create org
          </Button>
        </div>
        <h1 className="mt-4 text-2xl font-medium tracking-tight">{organization.name}</h1>
        <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
          Configure the organization selected in the sidebar.
        </p>
        {notice !== null && <p className="mt-4 text-[13px] text-accent-text">{notice}</p>}
        {pageError !== null && <p className="mt-4 text-[13px] text-destructive">{pageError}</p>}

        <div className="mt-7 flex max-w-3xl flex-col gap-7">
          <section className="border border-border-soft">
            <div className="border-b border-border-soft px-4 py-3">
              <h2 className="text-sm font-medium">General</h2>
              <p className="mt-1 text-xs text-muted-foreground">Basic organization details.</p>
            </div>
            <form className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end" onSubmit={saveName}>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label htmlFor="organization-name">Organization name</Label>
                <Input
                  disabled={savingName}
                  id="organization-name"
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </div>
              <Button
                disabled={savingName || name.trim() === "" || name.trim() === organization.name}
                type="submit"
                variant="primary"
              >
                {savingName ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium">Members</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {members.length} {members.length === 1 ? "member" : "members"}
                </p>
              </div>
              <Button
                onClick={() =>
                  setDialog({ kind: "invite", status: "ready", email: "", error: null })
                }
                type="button"
                variant="primary"
              >
                <UserPlus /> Invite member
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const currentUser = member.userId === initialSettings.currentUserId;
                  return (
                    <TableRow key={member.membershipId}>
                      <TableCell className="min-w-52">
                        <div className="flex items-center gap-2 font-medium">
                          {member.name}
                          {currentUser && <Badge variant="accent">You</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{member.email}</div>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {member.role}
                      </TableCell>
                      <TableCell>
                        <Badge>{member.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {currentUser ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <ActionMenu label={`Actions for ${member.email}`}>
                              <ActionMenuItem
                                destructive
                                onSelect={() =>
                                  setDialog({
                                    kind: "remove",
                                    status: "ready",
                                    member,
                                    error: null,
                                  })
                                }
                              >
                                <UserMinus /> Remove member
                              </ActionMenuItem>
                            </ActionMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>

          <section className="border border-destructive/40">
            <div className="border-b border-destructive/30 px-4 py-3">
              <h2 className="text-sm font-medium">Danger zone</h2>
            </div>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-medium">Leave organization</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  You will lose access to this organization and its resources.
                </p>
              </div>
              <Button
                disabled={initialSettings.organizationCount === 1}
                onClick={() => setDialog({ kind: "leave", status: "ready", error: null })}
                title={
                  initialSettings.organizationCount === 1
                    ? "Create or join another organization first"
                    : undefined
                }
                type="button"
                variant="destructive"
              >
                <LogOut /> Leave organization
              </Button>
            </div>
          </section>
        </div>
      </section>
      <OrganizationDialogView
        onClose={() => setDialog({ kind: "closed" })}
        onCreate={create}
        onInvite={invite}
        onLeave={leave}
        onRemove={remove}
        organization={organization}
        setState={setDialog}
        state={dialog}
      />
    </Shell>
  );
}

function OrganizationDialogView({
  state,
  setState,
  organization,
  onClose,
  onCreate,
  onInvite,
  onRemove,
  onLeave,
}: {
  readonly state: OrganizationDialog;
  readonly setState: (state: OrganizationDialog) => void;
  readonly organization: Organization;
  readonly onClose: () => void;
  readonly onCreate: () => void;
  readonly onInvite: () => void;
  readonly onRemove: () => void;
  readonly onLeave: () => void;
}): ReactNode {
  const submitting = state.kind !== "closed" && state.status === "submitting";
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (state.kind === "create") onCreate();
    if (state.kind === "invite") onInvite();
    if (state.kind === "remove") onRemove();
    if (state.kind === "leave") onLeave();
  };

  return (
    <Dialog
      onOpenChange={(open) => !open && !submitting && onClose()}
      open={state.kind !== "closed"}
    >
      <DialogContent>
        {state.kind !== "closed" && (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>
                {state.kind === "create" && "Create organization"}
                {state.kind === "invite" && "Invite member"}
                {state.kind === "remove" && "Remove member?"}
                {state.kind === "leave" && "Leave organization?"}
              </DialogTitle>
              <DialogDescription>
                {state.kind === "create" && "Create another organization and switch to it."}
                {state.kind === "invite" &&
                  `WorkOS will email an invitation to join ${organization.name}.`}
                {state.kind === "remove" &&
                  `${state.member.email} will lose access to ${organization.name}.`}
                {state.kind === "leave" &&
                  `You will lose access to ${organization.name}. Its data remains available to other members.`}
              </DialogDescription>
            </DialogHeader>
            {state.kind === "create" && (
              <div className="mt-4 flex flex-col gap-2">
                <Label htmlFor="create-organization-name">Organization name</Label>
                <Input
                  autoFocus
                  disabled={submitting}
                  id="create-organization-name"
                  maxLength={100}
                  onChange={(event) =>
                    setState({ ...state, name: event.target.value, error: null })
                  }
                  placeholder="Acme Inc"
                  required
                  value={state.name}
                />
              </div>
            )}
            {state.kind === "invite" && (
              <div className="mt-4 flex flex-col gap-2">
                <Label htmlFor="organization-invite-email">Email</Label>
                <Input
                  autoFocus
                  disabled={submitting}
                  id="organization-invite-email"
                  maxLength={254}
                  onChange={(event) =>
                    setState({ ...state, email: event.target.value, error: null })
                  }
                  placeholder="member@example.com"
                  required
                  type="email"
                  value={state.email}
                />
              </div>
            )}
            {state.error !== null && (
              <p className="mt-4 text-[13px] text-destructive">{state.error}</p>
            )}
            <DialogFooter className="mt-4">
              <Button disabled={submitting} onClick={onClose} type="button">
                Cancel
              </Button>
              {state.kind === "create" && (
                <Button
                  disabled={submitting || state.name.trim() === ""}
                  type="submit"
                  variant="primary"
                >
                  {submitting ? "Creating…" : "Create organization"}
                </Button>
              )}
              {state.kind === "invite" && (
                <Button
                  disabled={submitting || state.email.trim() === ""}
                  type="submit"
                  variant="primary"
                >
                  {submitting ? "Sending…" : "Send invitation"}
                </Button>
              )}
              {state.kind === "remove" && (
                <Button disabled={submitting} type="submit" variant="destructive">
                  <UserMinus /> {submitting ? "Removing…" : "Remove member"}
                </Button>
              )}
              {state.kind === "leave" && (
                <Button disabled={submitting} type="submit" variant="destructive">
                  <LogOut /> {submitting ? "Leaving…" : "Leave organization"}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
