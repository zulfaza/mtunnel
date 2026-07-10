export const TUNNEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function isValidTunnelId(id: string): boolean {
  return TUNNEL_ID_PATTERN.test(id);
}
