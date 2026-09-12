import { Check, Copy, KeyRound, Link, Trash2, UserRoundX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import { generateAccessCode } from "../lib/access-code.js";
import {
  deletePreviewAccessCode,
  previewAccess,
  revokePreviewAccessSession,
  updatePreview,
} from "../server/previews.js";
import { Button } from "./ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";

type Preview = Schemas.PreviewView;
type DeleteCodeState =
  | { readonly status: "idle" }
  | { readonly status: "confirming"; readonly id: string }
  | { readonly status: "deleting"; readonly id: string };
type RevokeSessionState =
  | { readonly status: "idle" }
  | { readonly status: "confirming"; readonly id: string }
  | { readonly status: "revoking"; readonly id: string };

export function PreviewAccessDialog({
  preview,
  onClose,
  onFailure,
  onUpdate,
}: {
  readonly preview: Preview | null;
  readonly onClose: () => void;
  readonly onFailure: (cause: unknown) => void;
  readonly onUpdate: (preview: Preview) => void;
}): ReactNode {
  const [access, setAccess] = useState<Schemas.PreviewAccessView | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteCodeState, setDeleteCodeState] = useState<DeleteCodeState>({ status: "idle" });
  const [revokeSessionState, setRevokeSessionState] = useState<RevokeSessionState>({
    status: "idle",
  });

  useEffect(() => {
    setAccess(null);
    setGeneratedCode(null);
    setCopied(null);
    setDeleteCodeState({ status: "idle" });
    setRevokeSessionState({ status: "idle" });
    if (preview === null) return;
    void previewAccess({ data: { previewId: preview.id } })
      .then(setAccess)
      .catch(onFailure);
  }, [onFailure, preview]);

  const generate = (): void => {
    if (preview === null) return;
    const code = generateAccessCode();
    setBusy(true);
    void updatePreview({ data: { id: preview.id, visibility: "code", accessCode: code } })
      .then(async (updated) => {
        onUpdate(updated);
        setGeneratedCode(code);
        setAccess(await previewAccess({ data: { previewId: preview.id } }));
      })
      .catch(onFailure)
      .finally(() => setBusy(false));
  };

  const deleteCode = (): void => {
    if (preview === null || deleteCodeState.status !== "confirming") return;
    const id = deleteCodeState.id;
    setDeleteCodeState({ status: "deleting", id });
    setBusy(true);
    void deletePreviewAccessCode({ data: { previewId: preview.id, id } })
      .then(() => {
        setGeneratedCode(null);
        setAccess((current) =>
          current === null
            ? null
            : { ...current, codes: current.codes.filter((code) => code.id !== id) },
        );
      })
      .catch(onFailure)
      .finally(() => {
        setBusy(false);
        setDeleteCodeState({ status: "idle" });
      });
  };

  const revokeSession = (): void => {
    if (preview === null || revokeSessionState.status !== "confirming") return;
    const id = revokeSessionState.id;
    setRevokeSessionState({ status: "revoking", id });
    setBusy(true);
    void revokePreviewAccessSession({ data: { previewId: preview.id, id } })
      .then(() =>
        setAccess((current) =>
          current === null
            ? null
            : { ...current, sessions: current.sessions.filter((session) => session.id !== id) },
        ),
      )
      .catch(onFailure)
      .finally(() => {
        setBusy(false);
        setRevokeSessionState({ status: "idle" });
      });
  };

  const copy = (target: "code" | "link"): void => {
    if (preview === null || generatedCode === null) return;
    const value =
      target === "code"
        ? generatedCode
        : `${preview.url}?code=${encodeURIComponent(generatedCode)}`;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(target);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={preview !== null}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Preview access</DialogTitle>
          <DialogDescription>
            Generate access codes and manage sessions for every version of “{preview?.name}”.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between border border-border-soft bg-muted p-3">
          <div>
            <p className="text-xs font-medium">Access code</p>
            <p className="text-xs text-muted-foreground">
              Reusable until replaced. Generating revokes the current code.
            </p>
          </div>
          <Button disabled={busy} onClick={generate} type="button" variant="primary">
            <KeyRound /> {busy ? "Working…" : "Generate code"}
          </Button>
        </div>
        {generatedCode !== null && (
          <div className="border border-accent-text/40 p-3">
            <p className="text-xs text-muted-foreground">Copy now. It won’t be shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-sm text-accent-text">
                {generatedCode}
              </code>
              <Button
                aria-label={copied === "code" ? "Copied" : "Copy code"}
                className={copied === "code" ? "border-accent-text text-accent-text" : undefined}
                onClick={() => copy("code")}
                size="icon"
                title={copied === "code" ? "Copied" : "Copy code"}
              >
                {copied === "code" ? <Check className="animate-copy-feedback" /> : <Copy />}
              </Button>
              <Button
                aria-label={copied === "link" ? "Copied" : "Copy link"}
                className={copied === "link" ? "border-accent-text text-accent-text" : undefined}
                onClick={() => copy("link")}
                size="icon"
                title={copied === "link" ? "Copied" : "Copy link with code"}
              >
                {copied === "link" ? <Check className="animate-copy-feedback" /> : <Link />}
              </Button>
            </div>
          </div>
        )}
        <AccessList
          busy={busy}
          empty="No active codes."
          heading="Active codes"
          items={access?.codes ?? null}
          onRemove={(id) => setDeleteCodeState({ status: "confirming", id })}
          removeIcon={<Trash2 />}
          removeLabel="Delete code"
        />
        <AccessList
          busy={busy}
          empty="No active sessions."
          heading="Active sessions"
          items={access?.sessions ?? null}
          onRemove={(id) => setRevokeSessionState({ status: "confirming", id })}
          removeIcon={<UserRoundX />}
          removeLabel="Revoke session"
        />
        <DeleteCodeDialog
          onClose={() => setDeleteCodeState({ status: "idle" })}
          onConfirm={deleteCode}
          state={deleteCodeState}
        />
        <RevokeSessionDialog
          onClose={() => setRevokeSessionState({ status: "idle" })}
          onConfirm={revokeSession}
          state={revokeSessionState}
        />
      </DialogContent>
    </Dialog>
  );
}

function RevokeSessionDialog({
  state,
  onClose,
  onConfirm,
}: {
  readonly state: RevokeSessionState;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  const revoking = state.status === "revoking";

  return (
    <Dialog onOpenChange={(open) => !open && !revoking && onClose()} open={state.status !== "idle"}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke active session?</DialogTitle>
          <DialogDescription>
            This session will immediately lose access to the preview.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={revoking} onClick={onClose} type="button">
            Cancel
          </Button>
          <Button disabled={revoking} onClick={onConfirm} type="button" variant="destructive">
            <UserRoundX /> {revoking ? "Revoking…" : "Revoke session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCodeDialog({
  state,
  onClose,
  onConfirm,
}: {
  readonly state: DeleteCodeState;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  const deleting = state.status === "deleting";

  return (
    <Dialog onOpenChange={(open) => !open && !deleting && onClose()} open={state.status !== "idle"}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete access code?</DialogTitle>
          <DialogDescription>
            This code will stop granting preview access. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={deleting} onClick={onClose} type="button">
            Cancel
          </Button>
          <Button disabled={deleting} onClick={onConfirm} type="button" variant="destructive">
            <Trash2 /> {deleting ? "Deleting…" : "Delete code"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccessList({
  busy,
  empty,
  heading,
  items,
  onRemove,
  removeIcon,
  removeLabel,
}: {
  readonly busy: boolean;
  readonly empty: string;
  readonly heading: string;
  readonly items:
    | readonly (Schemas.PreviewAccessCodeView | Schemas.PreviewAccessSessionView)[]
    | null;
  readonly onRemove: (id: string) => void;
  readonly removeIcon: ReactNode;
  readonly removeLabel: string;
}): ReactNode {
  return (
    <section>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {heading}
      </h3>
      {items === null ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-2 divide-y divide-border-soft border border-border-soft">
          {items.map((item) => (
            <div className="flex items-center justify-between gap-3 px-3 py-2" key={item.id}>
              <div className="min-w-0 text-xs">
                <p className="truncate font-medium">{item.id.slice(0, 12)}…</p>
                <p className="text-muted-foreground">
                  Created {formatDate(item.createdAt)}
                  {"expiresAt" in item ? ` · Expires ${formatDate(item.expiresAt)}` : ""}
                </p>
              </div>
              <Button
                aria-label={removeLabel}
                disabled={busy}
                onClick={() => onRemove(item.id)}
                size="icon"
                title={removeLabel}
                variant="destructive"
              >
                {removeIcon}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
