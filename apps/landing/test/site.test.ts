import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { SITE_METADATA } from "../src/lib/site-metadata.js";

function staticFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../static/${name}`, import.meta.url)), "utf8");
}

describe("site metadata", () => {
  it("keeps the manifest in sync with site metadata", () => {
    const manifest: unknown = JSON.parse(staticFile("site.webmanifest"));

    expect(manifest).toMatchObject({
      name: SITE_METADATA.name,
      description: SITE_METADATA.description,
      theme_color: SITE_METADATA.themeColor,
      start_url: SITE_METADATA.pages.home.path,
    });
  });

  it("points every page at a canonical path", () => {
    for (const { title, path } of Object.values(SITE_METADATA.pages)) {
      expect(title).toContain("mTunnel");
      expect(new URL(path, SITE_METADATA.origin).origin).toBe(SITE_METADATA.origin);
    }
  });
});

describe("installer", () => {
  it("downloads the mt release for the current platform", () => {
    const installer = staticFile("install.sh");

    expect(installer).toContain('asset="mt-$os-$arch.tar.gz"');
    expect(installer).toContain("github.com/$repo/releases/latest/download");
    expect(installer).toContain('install -m 0755 "$tmp/mt" "$dest/mt"');
  });
});
