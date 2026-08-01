import { errorPage } from "./pages.js";
import { jsonResponse } from "../../utils/json.js";

export function handleSiteRequest(request: Request, url: URL): Response | null {
  if (request.method !== "GET") return null;
  if (url.pathname === "/health") return jsonResponse({ status: "ok" });
  return null;
}

export function siteNotFound(): Response {
  return errorPage(404, "not_found", "This page does not exist, or the tunnel address is invalid.");
}
