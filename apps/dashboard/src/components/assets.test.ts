import type { Schemas } from "@tunnel/core";
import { describe, expect, it } from "vite-plus/test";
import { groupPreviews } from "../lib/preview-groups.js";

function preview(
  id: string,
  documentId: string,
  name: string,
  group: string | null,
  repositoryName: string,
  createdAt: number,
  version = 1,
): Schemas.PreviewView {
  return {
    id,
    documentId,
    name,
    version,
    url: `https://preview.test/${id}`,
    totalBytes: 1,
    fileCount: 1,
    createdAt,
    expiresAt: createdAt + 1,
    visibility: "public",
    group,
    repoHost: "github.com",
    repoOrg: "acme",
    repoName: repositoryName,
  };
}

describe("preview grouping", () => {
  it("combines worktree groups by repository", () => {
    const groups = groupPreviews([
      preview("3", "c", "c.html", "weekly", "zeta", 3),
      preview("2", "b", "b.html", "daily", "zeta", 2),
      preview("1", "a", "a.html", "daily", "alpha", 1),
    ]);
    expect(groups.map((group) => group.repositoryName)).toEqual(["alpha", "zeta"]);
    expect(groups[1]?.files.map((file) => file.id)).toEqual(["3", "2"]);
  });

  it("keeps only each file's latest version and sorts latest uploads first", () => {
    const groups = groupPreviews([
      preview("old", "summary", "summary.html", "eod-report", "reports", 1, 1),
      preview("details", "details", "details.html", "eod-report", "reports", 2),
      preview("new", "summary", "summary.html", "eod-report", "reports", 3, 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.files.map((file) => file.id)).toEqual(["new", "details"]);
  });

  it("keeps the newest file when worktrees created separate version histories", () => {
    const groups = groupPreviews([
      preview("worktree", "worktree-document", "og.html", "worktree-fixed-20260806", "mtunnel", 1),
      preview("main", "main-document", "og.html", null, "mtunnel", 2, 6),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.files.map((file) => file.id)).toEqual(["main"]);
  });
});
