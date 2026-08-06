import { Link, useNavigate } from "@tanstack/react-router";
import { Copy, ExternalLink, KeyRound, Trash2 } from "lucide-react";
import { Fragment, useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import { formatBytes, formatExpiry } from "../lib/preview-format.js";
import { groupPreviews } from "../lib/preview-groups.js";
import { createPreview, deletePreview, updatePreview } from "../server/previews.js";
import { PreviewAccessDialog } from "./preview-access.js";
import { SectionHeading, Shell } from "./shell.js";
import { ActionMenu, ActionMenuItem } from "./ui/action-menu.js";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.js";

type Preview = Schemas.PreviewView;

type DeletePreviewState =
  | { readonly status: "idle" }
  | { readonly status: "confirming"; readonly preview: Preview }
  | { readonly status: "deleting"; readonly preview: Preview };

function isPreviewVisibility(value: string): value is Preview["visibility"] {
  return value === "public" || value === "private" || value === "code";
}

const VISIBILITY_SELECT_CLASS: Record<Preview["visibility"], string> = {
  public: "border-accent-text/40 text-accent-text",
  private: "border-destructive/40 text-destructive",
  code: "border-amber-500/40 text-amber-600 dark:text-amber-400",
};

export function AssetsPage({
  initialPreviews,
}: {
  readonly initialPreviews: readonly Preview[] | null;
}): ReactNode {
  const navigate = useNavigate();
  const [previews, setPreviews] = useState<readonly Preview[] | null>(initialPreviews);
  const [error, setError] = useState<string | null>(null);
  const [accessPreview, setAccessPreview] = useState<Preview | null>(null);
  const [deleteState, setDeleteState] = useState<DeletePreviewState>({ status: "idle" });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const fail = useCallback(
    (cause: unknown): void => {
      if (cause instanceof Error && cause.message === "signed_out") {
        void navigate({ to: "/login" });
        return;
      }
      setError(cause instanceof Error ? cause.message : "Request failed.");
    },
    [navigate],
  );

  const applyVisibility = async (
    preview: Preview,
    visibility: Preview["visibility"],
    code?: string,
  ): Promise<void> => {
    setError(null);
    try {
      const updated = await updatePreview({
        data: {
          id: preview.id,
          visibility,
          ...(code === undefined ? {} : { accessCode: code }),
        },
      });
      setPreviews(
        (current) => current?.map((item) => (item.id === preview.id ? updated : item)) ?? null,
      );
    } catch (cause) {
      fail(cause);
    }
  };

  const uploadSelectedFile = (file: File | undefined): void => {
    if (file === undefined) return;
    setUploading(true);
    setError(null);
    void uploadPreviewFile(file)
      .then((created) =>
        setPreviews((current) => (current === null ? [created] : [created, ...current])),
      )
      .catch(fail)
      .finally(() => setUploading(false));
  };

  const upload = (event: FormEvent): void => {
    event.preventDefault();
    uploadSelectedFile(fileInput.current?.files?.[0]);
  };

  const removePreview = async (): Promise<void> => {
    if (deleteState.status !== "confirming") return;
    const preview = deleteState.preview;
    setDeleteState({ status: "deleting", preview });
    setError(null);
    try {
      await deletePreview({ data: { id: preview.id } });
      setPreviews((current) => current?.filter((item) => item.id !== preview.id) ?? null);
    } catch (cause) {
      fail(cause);
    } finally {
      setDeleteState({ status: "idle" });
    }
  };

  const copyUrl = (preview: Preview): void => {
    void navigator.clipboard.writeText(preview.url).then(() => {
      setCopiedId(preview.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  return (
    <Shell>
      <section className="flex-1 px-5 py-8 sm:px-8">
        <div className="flex items-center justify-between">
          <SectionHeading>Assets</SectionHeading>
          <Button
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            type="button"
            variant="primary"
          >
            + upload
          </Button>
        </div>
        <h1 className="mt-4 text-2xl font-medium tracking-tight">Preview assets</h1>
        <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
          Static previews uploaded with{" "}
          <code className="border border-border-soft bg-muted px-1.5 text-xs">mt preview</code>. Set
          each asset to public, private, or public with an access code.
        </p>
        <form className="hidden" onSubmit={upload}>
          <Input
            id="asset-files"
            onChange={() => uploadSelectedFile(fileInput.current?.files?.[0])}
            ref={fileInput}
            type="file"
          />
        </form>
        {error !== null && <p className="mt-4 text-[13px] text-destructive">{error}</p>}
        <div className="mt-6">
          {previews === null ? (
            <p className="text-[13px] text-muted-foreground">Loading assets…</p>
          ) : previews.length === 0 ? (
            <div className="border border-border-soft bg-muted px-5 py-4 text-[13px] leading-7">
              <p className="text-muted-foreground">No assets yet. Upload one from the terminal:</p>
              <p>
                <span className="select-none text-muted-foreground">$ </span>
                <span className="text-accent-text">mt preview ./dist</span>
              </p>
            </div>
          ) : (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-full">Name</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupPreviews(previews).map((group) => (
                  <Fragment key={group.key || "no-repository"}>
                    <TableRow>
                      <TableCell className="bg-muted py-2 text-xs font-medium" colSpan={4}>
                        {group.href !== null && (
                          <a
                            className="text-accent-text underline-offset-4 hover:underline"
                            href={group.href}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {group.repositoryName}
                          </a>
                        )}
                        {group.href === null && <span>{group.repositoryName}</span>}
                      </TableCell>
                    </TableRow>
                    {group.files.map((preview) => (
                      <TableRow key={preview.id}>
                        <TableCell className="min-w-0">
                          <Link
                            className="block truncate font-medium text-foreground underline-offset-4 hover:text-accent-text hover:underline"
                            params={{ documentId: preview.documentId }}
                            to="/assets/$documentId"
                          >
                            <span className="mr-1.5 text-accent-text">[v{preview.version}]</span>
                            {preview.name}
                          </Link>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {formatBytes(preview.totalBytes)} | {preview.version}{" "}
                            {preview.version === 1 ? "file" : "files"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            <Select
                              onValueChange={(value) => {
                                if (!isPreviewVisibility(value)) return;
                                const visibility = value;
                                if (visibility === "code") {
                                  setAccessPreview(preview);
                                  return;
                                }
                                void applyVisibility(preview, visibility);
                              }}
                              value={preview.visibility}
                            >
                              <SelectTrigger
                                className={`w-36 ${VISIBILITY_SELECT_CLASS[preview.visibility]}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="public">public</SelectItem>
                                <SelectItem value="private">private</SelectItem>
                                <SelectItem value="code">code</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatExpiry(preview.expiresAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <ActionMenu label={`Actions for ${preview.name}`}>
                              <ActionMenuItem asChild>
                                <a href={preview.url} rel="noreferrer" target="_blank">
                                  <ExternalLink /> Open preview
                                </a>
                              </ActionMenuItem>
                              {preview.visibility === "code" && (
                                <ActionMenuItem onSelect={() => setAccessPreview(preview)}>
                                  <KeyRound /> Manage access
                                </ActionMenuItem>
                              )}
                              <ActionMenuItem onSelect={() => copyUrl(preview)}>
                                <Copy
                                  className={copiedId === preview.id ? "text-accent-text" : ""}
                                />
                                {copiedId === preview.id ? "Copied" : "Copy URL"}
                              </ActionMenuItem>
                              <ActionMenuItem
                                destructive
                                onSelect={() => setDeleteState({ status: "confirming", preview })}
                              >
                                <Trash2 /> Delete preview
                              </ActionMenuItem>
                            </ActionMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
      <PreviewAccessDialog
        onClose={() => setAccessPreview(null)}
        onFailure={fail}
        onUpdate={(updated) => {
          setPreviews(
            (current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? null,
          );
        }}
        preview={accessPreview}
      />
      <DeletePreviewDialog
        onClose={() => setDeleteState({ status: "idle" })}
        onConfirm={() => void removePreview()}
        state={deleteState}
      />
    </Shell>
  );
}

function DeletePreviewDialog({
  state,
  onClose,
  onConfirm,
}: {
  readonly state: DeletePreviewState;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  const preview = state.status === "idle" ? null : state.preview;
  const deleting = state.status === "deleting";

  return (
    <Dialog onOpenChange={(open) => !open && !deleting && onClose()} open={preview !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete preview?</DialogTitle>
          <DialogDescription>
            This will permanently delete “{preview?.name}” and all its uploaded files. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={deleting} onClick={onClose} type="button">
            Cancel
          </Button>
          <Button disabled={deleting} onClick={onConfirm} type="button" variant="destructive">
            <Trash2 /> {deleting ? "Deleting…" : "Delete preview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function uploadPreviewFile(file: File): Promise<Preview> {
  const name = file.name;
  const manifest = [
    {
      path: name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      sha256: await fileHash(file),
    },
  ];
  const created = await createPreview({ data: { name, files: manifest } });
  const previewId = created.id;
  const response = await fetch(`/assets/upload/${encodePath(previewId)}/${encodePath(name)}`, {
    method: "PUT",
    body: file,
  });
  if (!response.ok) throw new Error(`Upload failed for ${name}.`);
  return created;
}

async function fileHash(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodePath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}
