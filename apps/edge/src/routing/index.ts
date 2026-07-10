import { isValidTunnelId } from "@tunnel/shared";

function withoutPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const closing = trimmed.indexOf("]");
    return closing === -1 ? trimmed : trimmed.slice(0, closing + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

export function tunnelIdFromHost(host: string | null, tunnelDomain: string): string | null {
  if (host === null) return null;
  const normalizedHost = withoutPort(host);
  const domain = tunnelDomain.trim().toLowerCase();
  const suffix = `.${domain}`;
  if (!normalizedHost.endsWith(suffix)) return null;
  const candidate = normalizedHost.slice(0, -suffix.length);
  return candidate.includes(".") || !isValidTunnelId(candidate) ? null : candidate;
}

export interface DevRoute {
  readonly tunnelId: string;
  readonly rewrittenPath: string;
}

export function tunnelIdFromDevPath(pathname: string): DevRoute | null {
  const parts = pathname.split("/");
  if (parts[1] !== "t" || parts[2] === undefined || !isValidTunnelId(parts[2])) return null;
  if (parts.length === 3) return { tunnelId: parts[2], rewrittenPath: "/" };
  return { tunnelId: parts[2], rewrittenPath: `/${parts.slice(3).join("/")}` };
}
