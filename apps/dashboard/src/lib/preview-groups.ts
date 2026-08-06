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

type PreviewGroupIdentity =
  | { readonly _tag: "custom"; readonly key: string; readonly name: string }
  | {
      readonly _tag: "repository";
      readonly key: string;
      readonly name: string;
      readonly href: string | null;
    }
  | { readonly _tag: "none" };

function previewGroupIdentity(preview: Preview): PreviewGroupIdentity {
  if (preview.group !== null && preview.group !== "")
    return { _tag: "custom", key: `group:${preview.group}`, name: preview.group };
  if (
    preview.repoOrg !== null &&
    preview.repoOrg !== "" &&
    preview.repoName !== null &&
    preview.repoName !== ""
  ) {
    return {
      _tag: "repository",
      key: `repository:${preview.repoHost ?? ""}/${preview.repoOrg}/${preview.repoName}`,
      name: preview.repoName,
      href:
        preview.repoHost === null
          ? null
          : `https://${preview.repoHost}/${preview.repoOrg}/${preview.repoName}`,
    };
  }
  return { _tag: "none" };
}

function newerPreview(left: Preview, right: Preview): Preview {
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? left : right;
  return left.version >= right.version ? left : right;
}

export function groupPreviews(previews: readonly Preview[]): readonly PreviewGroup[] {
  const groups = new Map<string, PreviewGroupBuilder>();
  for (const preview of previews) {
    const identity = previewGroupIdentity(preview);
    const key = identity._tag === "none" ? "none" : identity.key;
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
      repositoryName: identity._tag === "none" ? "None" : identity.name,
      href: identity._tag === "repository" ? identity.href : null,
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
