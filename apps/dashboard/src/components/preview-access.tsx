import { Copy, KeyRound, Trash2, UserRoundX } from "lucide-react";
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
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";

type Preview = Schemas.PreviewView;

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
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAccess(null);
    setGeneratedCode(null);
    setCopied(false);
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

  const deleteCode = (id: string): void => {
    if (preview === null || !window.confirm("Delete this unused code?")) return;
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
      .finally(() => setBusy(false));
  };

  const revokeSession = (id: string): void => {
    if (preview === null || !window.confirm("Revoke this active session?")) return;
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
      .finally(() => setBusy(false));
  };

  const copyCode = (): void => {
    if (generatedCode === null) return;
    void navigator.clipboard.writeText(generatedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={preview !== null}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Preview access</DialogTitle>
          <DialogDescription>
            Generate single-use codes and manage sessions for every version of “{preview?.name}”.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between border border-border-soft bg-muted p-3">
          <div>
            <p className="text-xs font-medium">One-time code</p>
            <p className="text-xs text-muted-foreground">Replaces any unused code.</p>
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
              <Button onClick={copyCode} size="icon" title={copied ? "Copied" : "Copy code"}>
                <Copy />
              </Button>
            </div>
          </div>
        )}
        <AccessList
          busy={busy}
          empty="No unused codes."
          heading="Unused codes"
          items={access?.codes ?? null}
          onRemove={deleteCode}
          removeIcon={<Trash2 />}
          removeLabel="Delete code"
        />
        <AccessList
          busy={busy}
          empty="No active sessions."
          heading="Active sessions"
          items={access?.sessions ?? null}
          onRemove={revokeSession}
          removeIcon={<UserRoundX />}
          removeLabel="Revoke session"
        />
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
