import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { PreviewAccess } from "@tunnel/core";
import { requireUser, SignedOutError } from "../server/session.js";

function returnUrl(request: Request): URL | null {
  const value = new URL(request.url).searchParams.get("return");
  if (value === null) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== env.PREVIEW_DOMAIN.toLowerCase() ||
      !/^\/[a-z2-7]{26}(?:\/.*)?$/u.test(url.pathname)
    )
      return null;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function redirect(url: URL): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: url.toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

function denied(url: URL): Response {
  url.searchParams.set("owner", "denied");
  return redirect(url);
}

export const Route = createFileRoute("/preview-owner-access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = returnUrl(request);
        if (target === null) return new Response("Bad request", { status: 400 });
        let user;
        try {
          user = await requireUser();
        } catch (cause) {
          if (cause instanceof SignedOutError) return denied(target);
          throw cause;
        }
        const previewId = target.pathname.split("/")[1];
        if (previewId === undefined) return new Response("Bad request", { status: 400 });
        const preview = await env.DOMAINS.prepare(
          "SELECT 1 AS owned FROM previews WHERE id = ? AND user_id = ? AND expires_at > ?",
        )
          .bind(previewId, user.userId, Date.now())
          .first<{ owned: number }>();
        if (preview?.owned !== 1 || env.AUTH_SECRET === undefined) return denied(target);
        const ticket = await PreviewAccess.previewOwnerTicket(env.AUTH_SECRET, {
          previewId,
          userId: user.userId,
          expiresAt: Date.now() + PreviewAccess.PREVIEW_OWNER_TICKET_TTL_MS,
        });
        target.searchParams.set("owner_ticket", ticket);
        return redirect(target);
      },
    },
  },
});
