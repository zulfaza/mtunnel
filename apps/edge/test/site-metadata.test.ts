import { describe, expect, it } from "vitest";

import { installScript, landingPage, siteManifest, termsPage } from "../src/pages.js";
import { SITE_METADATA } from "../src/site-metadata.js";

describe("site metadata", () => {
  it("renders configured metadata for each page", async () => {
    const landingHtml = await landingPage().text();
    const termsHtml = await termsPage().text();

    expect(landingHtml).toContain(`<title>${SITE_METADATA.pages.home.title}</title>`);
    expect(landingHtml).toContain(`rel="canonical" href="${SITE_METADATA.origin}/"`);
    expect(landingHtml).toContain(
      `property="og:image" content="${SITE_METADATA.origin}${SITE_METADATA.socialImage.path}"`,
    );
    expect(termsHtml).toContain(`rel="canonical" href="${SITE_METADATA.origin}/terms"`);
  });

  it("builds the manifest from site metadata", async () => {
    const manifest: unknown = await siteManifest().json();

    expect(manifest).toMatchObject({
      name: SITE_METADATA.name,
      description: SITE_METADATA.description,
      theme_color: SITE_METADATA.themeColor,
    });
  });

  it("uses mt in landing and installer commands", async () => {
    const landingHtml = await landingPage().text();
    const installer = await installScript().text();

    expect(landingHtml).toContain("<b>mt login</b>");
    expect(landingHtml).toContain("<b>mt http 3000</b>");
    expect(landingHtml).not.toContain("<b>tunnel login</b>");
    expect(installer).toContain('asset="mt-$os-$arch.tar.gz"');
    expect(installer).toContain('install -m 0755 "$tmp/mt" "$dest/mt"');
  });

  it("renders the sparse animated network globe", async () => {
    const landingHtml = await landingPage().text();

    expect(landingHtml).toContain('class="network-spin"');
    expect(landingHtml.match(/<path class="arc(?: dsh)?"/gu)).toHaveLength(16);
    expect(landingHtml.match(/<circle class="pkt p\d"/gu)).toHaveLength(3);
    expect(landingHtml).not.toContain('class="globe-world"');
  });
});
