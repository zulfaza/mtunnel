import type { Schemas } from "@tunnel/core";

type Preview = Schemas.PreviewView;

export interface PreviewGroup {
  readonly key: string;
  readonly repositoryName: string;
  readonly href: string | null;
  readonly files: readonly Preview[];
}

interface PreviewGroupBuilder {
  readonly key: string;
  readonly repositoryName: string;
  readonly href: string | null;
  readonly files: Map<string, Preview>;
}

function newerPreview(left: Preview, right: Preview): Preview {
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? left : right;
  return left.version >= right.version ? left : right;
}

export function groupPreviews(previews: readonly Preview[]): readonly PreviewGroup[] {
  const groups = new Map<string, PreviewGroupBuilder>();
  for (const preview of previews) {
    const hasRepository =
      preview.repoOrg !== null &&
      preview.repoOrg !== "" &&
      preview.repoName !== null &&
      preview.repoName !== "";
    const repositoryKey = hasRepository
      ? `${preview.repoHost ?? ""}/${preview.repoOrg}/${preview.repoName}`
      : "";
    const key = repositoryKey;
    const existing = groups.get(key);
    if (existing !== undefined) {
      const current = existing.files.get(preview.name);
      existing.files.set(
        preview.name,
        current === undefined ? preview : newerPreview(current, preview),
      );
      continue;
    }
    groups.set(key, {
      key,
      repositoryName: hasRepository ? preview.repoName : "No repository",
      href:
        hasRepository && preview.repoHost !== null
          ? `https://${preview.repoHost}/${preview.repoOrg}/${preview.repoName}`
          : null,
      files: new Map([[preview.name, preview]]),
    });
  }
  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      repositoryName: group.repositoryName,
      href: group.href,
      files: [...group.files.values()].sort(
        (left, right) => right.createdAt - left.createdAt || left.name.localeCompare(right.name),
      ),
    }))
    .sort((left, right) => left.repositoryName.localeCompare(right.repositoryName));
}
