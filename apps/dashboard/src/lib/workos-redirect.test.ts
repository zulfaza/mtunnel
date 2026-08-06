import { describe, expect, it } from "vite-plus/test";
import { workosRedirectUri } from "./workos-redirect.js";

describe("WorkOS redirect URI", () => {
  it("uses HTTPS for a production HTTP request", () => {
    expect(workosRedirectUri(new URL("http://app.makarima.xyz/login"))).toBe(
      "https://app.makarima.xyz/callback",
    );
  });

  it("preserves HTTPS for a production request", () => {
    expect(workosRedirectUri(new URL("https://app.makarima.xyz/login"))).toBe(
      "https://app.makarima.xyz/callback",
    );
  });

  it("preserves HTTP for local development", () => {
    expect(workosRedirectUri(new URL("http://localhost:3000/login"))).toBe(
      "http://localhost:3000/callback",
    );
    expect(workosRedirectUri(new URL("http://127.0.0.1:3000/login"))).toBe(
      "http://127.0.0.1:3000/callback",
    );
  });
});
