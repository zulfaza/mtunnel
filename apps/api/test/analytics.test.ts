import { afterEach, describe, expect, it, vi } from "vitest";
import { capture } from "../src/analytics.js";
import type { Env } from "../src/env.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PostHog analytics", () => {
  it("does nothing when analytics is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await capture({} as Env, { event: "site_page_viewed" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures an anonymous event without profiles or GeoIP enrichment", async () => {
    const response = new Response("ok", { status: 200 });
    const cancel = vi.spyOn(response.body!, "cancel");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await capture(
      {
        POSTHOG_API_KEY: "phc_test",
        POSTHOG_HOST: "https://eu.i.posthog.com/",
      } as Env,
      {
        event: "site_page_viewed",
        properties: { page: "home", omitted: undefined },
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://eu.i.posthog.com/capture/");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body as string)).toEqual({
      api_key: "phc_test",
      event: "site_page_viewed",
      properties: {
        page: "home",
        distinct_id: expect.any(String),
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
  });

  it("does not propagate delivery failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      capture({ POSTHOG_API_KEY: "phc_test" } as Env, { event: "installer_downloaded" }),
    ).resolves.toBeUndefined();
  });
});
