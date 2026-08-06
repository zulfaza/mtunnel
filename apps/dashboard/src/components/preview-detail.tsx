import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import { formatBytes, formatExpiry, formatUploadTime } from "../lib/preview-format.js";
import { deletePreview } from "../server/previews.js";
import { SectionHeading, Shell } from "./shell.js";
import { ActionMenu, ActionMenuItem } from "./ui/action-menu.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.js";

type Preview = Schemas.PreviewView;

const VISIBILITY_VARIANT: Record<Preview["visibility"], "accent" | "default" | "destructive"> = {
  public: "accent",
  private: "destructive",
  code: "default",
};

function repositoryHref(preview: Preview): string | null {
  if (preview.repoHost === null || preview.repoOrg === null || preview.repoName === null)
    return null;
  return `https://${preview.repoHost}/${preview.repoOrg}/${preview.repoName}`;
}

export function PreviewDetailPage({
  versions,
}: {
  readonly versions: readonly Preview[];
}): ReactNode {
  const navigate = useNavigate();
  const [currentVersions, setCurrentVersions] = useState(versions);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = currentVersions[0];
  if (latest === undefined) return null;
  const repositoryUrl = repositoryHref(latest);

  const removeVersion = async (preview: Preview): Promise<void> => {
    if (!window.confirm(`Delete ${preview.name} v${preview.version}? This cannot be undone.`))
      return;
    setDeletingId(preview.id);
    setError(null);
    try {
      await deletePreview({ data: { id: preview.id } });
      const remaining = currentVersions.filter((version) => version.id !== preview.id);
      if (remaining.length === 0) {
        await navigate({ to: "/" });
        return;
      }
      setCurrentVersions(remaining);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "signed_out") {
        await navigate({ to: "/login" });
        return;
      }
      setError(cause instanceof Error ? cause.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Shell>
      <section className="flex-1 px-5 py-8 sm:px-8">
        <Link
          className="inline-flex items-center gap-1 text-xs text-muted-foreground no-underline hover:text-foreground"
          to="/"
        >
          <ArrowLeft className="size-3" /> assets
        </Link>
        <div className="mt-6 flex flex-col gap-4 border-b border-border-soft pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <SectionHeading>Asset details</SectionHeading>
            <h1 className="mt-3 text-2xl font-medium tracking-tight">{latest.name}</h1>
            <p className="mt-2 text-xs text-muted-foreground">
              {latest.group !== null && (
                <>
                  <span>{latest.group}</span>
                  <span className="mx-2">/</span>
                </>
              )}
              {repositoryUrl === null ? (
                <span>{latest.repoName ?? "No repository"}</span>
              ) : (
                <a
                  className="text-accent-text underline-offset-4 hover:underline"
                  href={repositoryUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {latest.repoName}
                </a>
              )}
            </p>
          </div>
          <Button asChild variant="primary">
            <a href={latest.url} rel="noreferrer" target="_blank">
              open latest <ExternalLink />
            </a>
          </Button>
        </div>

        <div className="mt-7 flex items-center justify-between">
          <SectionHeading>Version history</SectionHeading>
          <span className="text-xs text-muted-foreground">
            {currentVersions.length} {currentVersions.length === 1 ? "version" : "versions"}
          </span>
        </div>
        {error !== null && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-3">
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Contents</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentVersions.map((preview, index) => (
                <TableRow key={preview.id}>
                  <TableCell className="font-medium">
                    v{preview.version}
                    {index === 0 && (
                      <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-accent-text">
                        latest
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatUploadTime(preview.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={VISIBILITY_VARIANT[preview.visibility]}>
                      {preview.visibility}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {preview.fileCount} {preview.fileCount === 1 ? "file" : "files"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBytes(preview.totalBytes)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatExpiry(preview.expiresAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <ActionMenu label={`Actions for version ${preview.version}`}>
                        <ActionMenuItem asChild>
                          <a href={preview.url} rel="noreferrer" target="_blank">
                            <ExternalLink /> Open version
                          </a>
                        </ActionMenuItem>
                        <ActionMenuItem
                          destructive
                          disabled={deletingId !== null}
                          onSelect={() => void removeVersion(preview)}
                        >
                          <Trash2 /> Delete version
                        </ActionMenuItem>
                      </ActionMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </Shell>
  );
}
