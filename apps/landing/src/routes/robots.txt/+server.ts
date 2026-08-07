import { SITE_METADATA } from "$lib/site-metadata";

export function GET(): Response {
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${SITE_METADATA.origin}/sitemap.xml\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
