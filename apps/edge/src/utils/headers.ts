import type { HeaderPairs } from "@tunnel/protocol";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function connectionTokens(values: readonly string[]): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const token of value.split(",")) {
      const name = token.trim().toLowerCase();
      if (name !== "") tokens.add(name);
    }
  }
  return tokens;
}

export function stripHopByHopHeaderPairs(headers: HeaderPairs): HeaderPairs {
  const connection = connectionTokens(
    headers.filter(([name]) => name.toLowerCase() === "connection").map(([, value]) => value),
  );
  return headers.filter(([name]) => {
    const normalized = name.toLowerCase();
    return !HOP_BY_HOP.has(normalized) && !connection.has(normalized);
  });
}

export function headersToPairs(headers: Headers): HeaderPairs {
  const pairs: HeaderPairs = [];
  const getSetCookie = headers.getSetCookie;
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "set-cookie" || typeof getSetCookie !== "function") {
      pairs.push([name, value]);
    }
  }
  if (typeof getSetCookie === "function") {
    for (const value of getSetCookie.call(headers)) pairs.push(["set-cookie", value]);
  }
  return pairs;
}

export function stripHopByHopHeaders(headers: Headers): Headers {
  const pairs = stripHopByHopHeaderPairs(headersToPairs(headers));
  const result = new Headers();
  for (const [name, value] of pairs) result.append(name, value);
  return result;
}

export function stripInternalHeaders(headers: Headers): Headers {
  const result = new Headers();
  for (const [name, value] of headers) {
    if (!name.toLowerCase().startsWith("x-ztunnel-")) result.append(name, value);
  }
  return result;
}
