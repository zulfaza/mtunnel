import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("auth proxy rate limiting", () => {
  it("returns 429 once the per-IP auth rate limit is exhausted", async () => {
    const limits = await Promise.all(
      Array.from({ length: 30 }, () => env.AUTH_RATE_LIMITER.limit({ key: "device:203.0.113.5" })),
    );
    expect(limits.every(({ success }) => success)).toBe(true);

    const response = await SELF.fetch("http://worker.test/api/v1/auth/device", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
      body: "{}",
    });
    expect(response.status).toBe(429);
  });

  it("returns 429 once the per-IP tunnel proxy limit is exhausted", async () => {
    const limits = await Promise.all(
      Array.from({ length: 300 }, () =>
        env.PROXY_RATE_LIMITER.limit({ key: "203.0.113.6:limited-tunnel" }),
      ),
    );
    expect(limits.every(({ success }) => success)).toBe(true);

    const response = await SELF.fetch("http://worker.test/t/limited-tunnel/test", {
      headers: { "cf-connecting-ip": "203.0.113.6" },
    });
    expect(response.status).toBe(429);
  });
});
