import { env, SELF } from "cloudflare:test";
import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Env } from "../src/env.js";
import { handleNotificationSend } from "../src/routes/(api)/notifications.js";

const deviceId = "018f05c9-7b4a-4db7-8d2b-11a0a9f78431";
const pushToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const apnsPrivateKey = await exportPKCS8(privateKey);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function registerDevice(): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/v1/devices/${deviceId}/push-token`, {
    method: "PUT",
    headers: {
      authorization: "Bearer development-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ pushToken, platform: "ios", environment: "development" }),
  });
}

describe("notification devices", () => {
  it("registers a push token for the authenticated user", async () => {
    const response = await registerDevice();

    expect(response.status).toBe(204);
    await expect(
      env.DOMAINS.prepare(
        `SELECT user_id, organization_id, push_token, platform, environment
         FROM notification_devices WHERE device_id = ?`,
      )
        .bind(deviceId)
        .first(),
    ).resolves.toEqual({
      user_id: "development-user",
      organization_id: "development-organization",
      push_token: pushToken,
      platform: "ios",
      environment: "development",
    });
  });

  it("requires authentication to register a push token", async () => {
    const response = await SELF.fetch(`https://worker.test/api/v1/devices/${deviceId}/push-token`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pushToken, platform: "ios", environment: "development" }),
    });

    expect(response.status).toBe(401);
  });

  it("resolves an iOS device ID and sends its native token to APNs", async () => {
    await registerDevice();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 200, headers: { "apns-id": "apns-message" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleNotificationSend(
      new Request("https://worker.test/api/v1/notifications", {
        method: "POST",
        headers: {
          authorization: "Bearer notification-test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deviceId,
          title: "Tunnel connected",
          body: "Your tunnel is ready.",
          data: { tunnelId: "example" },
        }),
      }),
      {
        DOMAINS: env.DOMAINS,
        NOTIFICATION_API_KEY: "notification-test-key",
        APNS_KEY_ID: "TESTKEY",
        APNS_TEAM_ID: "TESTTEAM",
        APNS_PRIVATE_KEY: apnsPrivateKey,
        APNS_BUNDLE_ID: "com.zulfaza.testexpoapp",
      } as Env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      messageId: "apns-message",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.sandbox.push.apple.com/3/device/${pushToken}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          tunnelId: "example",
          aps: {
            alert: { title: "Tunnel connected", body: "Your tunnel is ready." },
            sound: "default",
          },
        }),
      }),
    );
  });

  it("requires the server notification key to send", async () => {
    const response = await handleNotificationSend(
      new Request("https://worker.test/api/v1/notifications", {
        method: "POST",
        headers: {
          authorization: "Bearer incorrect",
          "content-type": "application/json",
        },
        body: JSON.stringify({ deviceId, title: "Title", body: "Body" }),
      }),
      {
        DOMAINS: env.DOMAINS,
        NOTIFICATION_API_KEY: "notification-test-key",
      } as Env,
    );

    expect(response.status).toBe(401);
  });
});
