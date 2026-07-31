import type { Env } from "../../env.js";
import {
  docsPage,
  errorPage,
  installScript,
  landingPage,
  siteManifest,
  termsPage,
} from "./pages.js";
import { jsonResponse } from "../../utils/json.js";
import type { TrackedEvent } from "../tracked-event.js";

const SITE_ASSET_PATHS = new Set([
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/apple-touch-icon.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/favicon.ico",
  "/favicon.png",
  "/og.png",
]);

export function handleSiteRequest(
  request: Request,
  env: Env,
  url: URL,
  isPrimaryHost: boolean,
): Response | Promise<Response> | null {
  if (request.method !== "GET") return null;
  if (isPrimaryHost && SITE_ASSET_PATHS.has(url.pathname)) return env.ASSETS.fetch(request);
  if (isPrimaryHost && url.pathname === "/") return landingPage();
  if (isPrimaryHost && url.pathname === "/docs") return docsPage();
  if (isPrimaryHost && url.pathname === "/terms") return termsPage();
  if (isPrimaryHost && url.pathname === "/site.webmanifest") return siteManifest();
  if (isPrimaryHost && url.pathname === "/install.sh") return installScript();
  if (url.pathname === "/health") return jsonResponse({ status: "ok" });
  return null;
}

export function siteNotFound(): Response {
  return errorPage(404, "not_found", "This page does not exist, or the tunnel address is invalid.");
}

export function trackedSiteEvent(
  request: Request,
  url: URL,
  isPrimaryHost: boolean,
): TrackedEvent | null {
  if (request.method !== "GET" || !isPrimaryHost) return null;
  const page = new Map([
    ["/", "home"],
    ["/docs", "docs"],
    ["/terms", "terms"],
  ]).get(url.pathname);
  if (page !== undefined) return { event: "site_page_viewed", properties: { page } };
  if (url.pathname === "/install.sh") return { event: "installer_downloaded" };
  return null;
}
