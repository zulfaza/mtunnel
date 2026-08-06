const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function workosRedirectUri(requestUrl: URL): string {
  const callbackUrl = new URL("/callback", requestUrl);
  if (!localHosts.has(callbackUrl.hostname)) callbackUrl.protocol = "https:";
  return callbackUrl.toString();
}
