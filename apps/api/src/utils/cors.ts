import type { Env } from "../env.js";

function allowedOrigin(origin: string | null, env: Pick<Env, "TUNNEL_DOMAIN">): string | null {
  if (origin === null) return null;
  if (origin === `https://app.${env.TUNNEL_DOMAIN.toLowerCase()}`) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(origin)) return origin;
  return null;
}

export function corsPreflight(request: Request, env: Pick<Env, "TUNNEL_DOMAIN">): Response {
  const origin = allowedOrigin(request.headers.get("origin"), env);
  if (origin === null) return new Response(null, { status: 204 });
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers":
        request.headers.get("access-control-request-headers") ??
        "authorization,content-type,x-organization-id",
      "access-control-max-age": "86400",
      vary: "origin",
    },
  });
}

export function withCors(
  request: Request,
  env: Pick<Env, "TUNNEL_DOMAIN">,
  response: Response,
): Response {
  if (response.status === 101) return response;
  const origin = allowedOrigin(request.headers.get("origin"), env);
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.append("vary", "origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
