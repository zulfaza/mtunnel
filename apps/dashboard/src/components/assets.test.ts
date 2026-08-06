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
  repositoryOrganization: string | null = "acme",
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
    repoOrg: repositoryOrganization,
    repoName: repositoryName,
  };
}

describe("preview grouping", () => {
  it("groups by custom group before repository", () => {
    const groups = groupPreviews([
      preview("3", "c", "c.html", "weekly", "zeta", 3),
      preview("2", "b", "b.html", "daily", "zeta", 2),
      preview("1", "a", "a.html", "daily", "alpha", 1),
    ]);
    expect(groups.map((group) => group.repositoryName)).toEqual(["daily", "weekly"]);
    expect(groups[0]?.files.map((file) => file.id)).toEqual(["2", "1"]);
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

  it("keeps custom and repository groups separate", () => {
    const groups = groupPreviews([
      preview("worktree", "worktree-document", "og.html", "worktree-fixed-20260806", "mtunnel", 1),
      preview("main", "main-document", "og.html", null, "mtunnel", 2, 6),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.repositoryName)).toEqual([
      "mtunnel",
      "worktree-fixed-20260806",
    ]);
  });

  it("groups previews without custom or repository metadata as none", () => {
    const groups = groupPreviews([
      preview("ungrouped", "ungrouped", "site.html", null, "", 1, 1, null),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("none");
    expect(groups[0]?.repositoryName).toBe("None");
  });
});
