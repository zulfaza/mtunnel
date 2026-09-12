import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { PreviewAccess } from "@tunnel/core";
import { requireUser, SignedOutError } from "../server/session.js";

// The preview host cannot read the dashboard session cookie (host-only on app.<domain>,
// encrypted with SESSION_SECRET), so ownership is proven here and handed to the preview
// worker as a short-lived HMAC ticket signed with the shared AUTH_SECRET.
function returnUrl(request: Request): URL | null {
  const value = new URL(request.url).searchParams.get("return");
  if (value === null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== env.PREVIEW_DOMAIN.toLowerCase() ||
    !/^\/[a-z2-7]{26}(?:\/.*)?$/u.test(url.pathname)
  )
    return null;
  url.search = "";
  url.hash = "";
  return url;
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

export const Route = createFileRoute("/preview-owner-access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = returnUrl(request);
        if (target === null) return new Response("Bad request", { status: 400 });
        const previewId = target.pathname.split("/")[1];
        if (previewId === undefined) return new Response("Bad request", { status: 400 });
        let user;
        try {
          user = await requireUser();
        } catch (cause) {
          // The preview set its probe cookie before bouncing here, so returning to the
          // clean URL shows the access code gate instead of bouncing again.
          if (cause instanceof SignedOutError) return redirect(target);
          throw cause;
        }
        const preview = await env.DOMAINS.prepare(
          "SELECT 1 AS owned FROM previews WHERE id = ? AND organization_id = ? AND expires_at > ?",
        )
          .bind(previewId, user.organizationId, Date.now())
          .first<{ owned: number }>();
        if (preview?.owned !== 1 || env.AUTH_SECRET === undefined) return redirect(target);
        target.searchParams.set(
          "owner_ticket",
          await PreviewAccess.previewOwnerTicket(env.AUTH_SECRET, {
            previewId,
            organizationId: user.organizationId,
            expiresAt: Date.now() + PreviewAccess.PREVIEW_OWNER_TICKET_TTL_MS,
          }),
        );
        return redirect(target);
      },
    },
  },
});
