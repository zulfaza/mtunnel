import { useNavigate } from "@tanstack/react-router";
import { Copy, ExternalLink, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiFetch, AuthError, clearAuth, storedAuth } from "../lib/auth.js";
import { SectionHeading, Shell } from "./shell.js";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.js";

interface Preview {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly visibility: "public" | "private" | "code";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
}

function formatExpiry(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "expired";
  const hours = Math.round(remaining / 3_600_000);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

const VISIBILITY_BADGE: Record<Preview["visibility"], ReactNode> = {
  public: <Badge variant="accent">public</Badge>,
  private: <Badge variant="destructive">private</Badge>,
  code: <Badge>code</Badge>,
};

export function AssetsPage(): ReactNode {
  const navigate = useNavigate();
  const [previews, setPreviews] = useState<readonly Preview[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codePrompt, setCodePrompt] = useState<Preview | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fail = useCallback(
    (cause: unknown): void => {
      if (cause instanceof AuthError) {
        void navigate({ to: "/login" });
        return;
      }
      setError(cause instanceof Error ? cause.message : "Request failed.");
    },
    [navigate],
  );

  useEffect(() => {
    const auth = storedAuth();
    if (auth === null) {
      void navigate({ to: "/login" });
      return;
    }
    setEmail(auth.email);
    apiFetch("/api/v1/previews")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load assets (status ${response.status}).`);
        const body = (await response.json()) as { previews: readonly Preview[] };
        setPreviews(body.previews);
      })
      .catch(fail);
  }, [fail, navigate]);

  const applyVisibility = async (
    preview: Preview,
    visibility: Preview["visibility"],
    code?: string,
  ): Promise<void> => {
    setError(null);
    try {
      const response = await apiFetch(`/api/v1/previews/${preview.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          visibility === "code" ? { visibility, accessCode: code } : { visibility },
        ),
      });
      if (!response.ok) throw new Error(`Could not update visibility (status ${response.status}).`);
      const updated = (await response.json()) as Preview;
      setPreviews(
        (current) => current?.map((item) => (item.id === preview.id ? updated : item)) ?? null,
      );
    } catch (cause) {
      fail(cause);
    }
  };

  const submitAccessCode = (event: FormEvent): void => {
    event.preventDefault();
    if (codePrompt === null || accessCode.length < 4) return;
    void applyVisibility(codePrompt, "code", accessCode).then(() => {
      setCodePrompt(null);
      setAccessCode("");
    });
  };

  const deletePreview = async (preview: Preview): Promise<void> => {
    if (!window.confirm(`Delete preview "${preview.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const response = await apiFetch(`/api/v1/previews/${preview.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Could not delete preview (status ${response.status}).`);
      setPreviews((current) => current?.filter((item) => item.id !== preview.id) ?? null);
    } catch (cause) {
      fail(cause);
    }
  };

  const copyUrl = (preview: Preview): void => {
    void navigator.clipboard.writeText(preview.url).then(() => {
      setCopiedId(preview.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const signOut = (): void => {
    clearAuth();
    void navigate({ to: "/login" });
  };

  return (
    <Shell
      actions={
        <span className="flex items-center gap-3">
          <span className="hidden text-[13px] text-muted-foreground sm:inline">{email}</span>
          <Button onClick={signOut} variant="ghost">
            sign out
          </Button>
        </span>
      }
    >
      <section className="flex-1 px-5 py-8 sm:px-8">
        <SectionHeading>Assets</SectionHeading>
        <h1 className="mt-4 text-2xl font-medium tracking-tight">Preview assets</h1>
        <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
          Static previews uploaded with{" "}
          <code className="border border-border-soft bg-muted px-1.5 text-xs">mt preview</code>. Set
          each asset to public, private, or public with an access code.
        </p>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previews.map((preview) => (
                  <TableRow key={preview.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{preview.name}</span>
                        <a
                          className="inline-flex items-center gap-1 text-xs text-accent-text underline-offset-4 hover:underline"
                          href={preview.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {new URL(preview.url).host}/{preview.id.slice(0, 8)}…
                          <ExternalLink className="size-3" />
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          onValueChange={(value) => {
                            const visibility = value as Preview["visibility"];
                            if (visibility === "code") {
                              setCodePrompt(preview);
                              setAccessCode("");
                              return;
                            }
                            void applyVisibility(preview, visibility);
                          }}
                          value={preview.visibility}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="public">public</SelectItem>
                            <SelectItem value="private">private</SelectItem>
                            <SelectItem value="code">public with code</SelectItem>
                          </SelectContent>
                        </Select>
                        {VISIBILITY_BADGE[preview.visibility]}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{preview.fileCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBytes(preview.totalBytes)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatExpiry(preview.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          aria-label="Copy URL"
                          onClick={() => copyUrl(preview)}
                          size="icon"
                          title={copiedId === preview.id ? "Copied" : "Copy URL"}
                          variant="ghost"
                        >
                          <Copy className={copiedId === preview.id ? "text-accent-text" : ""} />
                        </Button>
                        <Button
                          aria-label="Delete preview"
                          onClick={() => void deletePreview(preview)}
                          size="icon"
                          title="Delete"
                          variant="destructive"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
      <Dialog
        onOpenChange={(open) => {
          if (!open) setCodePrompt(null);
        }}
        open={codePrompt !== null}
      >
        <DialogContent>
          <form onSubmit={submitAccessCode}>
            <DialogHeader>
              <DialogTitle>Set access code</DialogTitle>
              <DialogDescription>
                “{codePrompt?.name}” stays reachable by URL, but visitors must enter this code
                first.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex flex-col gap-2">
              <Label htmlFor="access-code">Access code</Label>
              <Input
                autoFocus
                id="access-code"
                minLength={4}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="at least 4 characters"
                required
                value={accessCode}
              />
            </div>
            <DialogFooter className="mt-5">
              <Button onClick={() => setCodePrompt(null)} type="button">
                Cancel
              </Button>
              <Button disabled={accessCode.length < 4} type="submit" variant="primary">
                Protect asset
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
