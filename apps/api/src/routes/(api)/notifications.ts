import { SignJWT, importPKCS8 } from "jose";
import { authenticateUser, authErrorResponse } from "../../auth/workos.js";
import type { Env } from "../../env.js";
import { jsonError, jsonResponse } from "../../utils/json.js";

const deviceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const googleTokenUrl = "https://oauth2.googleapis.com/token";

interface NotificationDeviceInput {
  readonly pushToken: string;
  readonly platform: "android" | "ios";
  readonly environment: "development" | "production";
}

interface NotificationInput {
  readonly deviceId: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
}

interface NotificationDevice {
  readonly push_token: string;
  readonly platform: "android" | "ios";
  readonly environment: "development" | "production";
}

interface ProviderResult {
  readonly messageId: string;
}

class NotificationProviderError extends Error {
  constructor(
    readonly kind: "misconfigured" | "unavailable" | "rejected",
    readonly invalidToken = false,
  ) {
    super(kind);
  }
}

let apnsAuthorization:
  | {
      readonly credential: string;
      readonly token: string;
      readonly expiresAt: number;
    }
  | undefined;
let fcmAuthorization:
  | {
      readonly credential: string;
      readonly token: string;
      readonly expiresAt: number;
    }
  | undefined;

async function requestBody(request: Request): Promise<unknown | null> {
  return request.json().catch(() => null);
}

function notificationDeviceInput(value: unknown): NotificationDeviceInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.pushToken !== "string" ||
    input.pushToken.length === 0 ||
    input.pushToken.length > 4096 ||
    (input.platform !== "android" && input.platform !== "ios") ||
    (input.environment !== "development" && input.environment !== "production")
  )
    return null;
  return {
    pushToken: input.pushToken,
    platform: input.platform,
    environment: input.environment,
  };
}

function notificationInput(value: unknown): NotificationInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.deviceId !== "string" ||
    !deviceIdPattern.test(input.deviceId) ||
    typeof input.title !== "string" ||
    input.title.length === 0 ||
    input.title.length > 100 ||
    typeof input.body !== "string" ||
    input.body.length === 0 ||
    input.body.length > 1000 ||
    (input.data !== undefined &&
      (typeof input.data !== "object" || input.data === null || Array.isArray(input.data)))
  )
    return null;
  return {
    deviceId: input.deviceId,
    title: input.title,
    body: input.body,
    ...(input.data === undefined ? {} : { data: input.data as Record<string, unknown> }),
  };
}

function privateKey(value: string): string {
  return value.replaceAll("\\n", "\n");
}

async function apnsBearerToken(env: Env): Promise<string> {
  if (
    env.APNS_KEY_ID === undefined ||
    env.APNS_TEAM_ID === undefined ||
    env.APNS_PRIVATE_KEY === undefined
  )
    throw new NotificationProviderError("misconfigured");
  const credential = `${env.APNS_TEAM_ID}:${env.APNS_KEY_ID}:${env.APNS_PRIVATE_KEY}`;
  const now = Math.floor(Date.now() / 1000);
  if (
    apnsAuthorization !== undefined &&
    apnsAuthorization.credential === credential &&
    apnsAuthorization.expiresAt > now
  )
    return apnsAuthorization.token;

  const key = await importPKCS8(privateKey(env.APNS_PRIVATE_KEY), "ES256").catch(() => {
    throw new NotificationProviderError("misconfigured");
  });
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APNS_KEY_ID })
    .setIssuer(env.APNS_TEAM_ID)
    .setIssuedAt(now)
    .sign(key);
  apnsAuthorization = {
    credential,
    token,
    expiresAt: now + 50 * 60,
  };
  return token;
}

async function fcmBearerToken(env: Env): Promise<string> {
  if (
    env.FCM_CLIENT_EMAIL === undefined ||
    env.FCM_PRIVATE_KEY === undefined ||
    env.FCM_PROJECT_ID === undefined
  )
    throw new NotificationProviderError("misconfigured");
  const credential = `${env.FCM_CLIENT_EMAIL}:${env.FCM_PROJECT_ID}:${env.FCM_PRIVATE_KEY}`;
  const now = Math.floor(Date.now() / 1000);
  if (
    fcmAuthorization !== undefined &&
    fcmAuthorization.credential === credential &&
    fcmAuthorization.expiresAt > now
  )
    return fcmAuthorization.token;

  const key = await importPKCS8(privateKey(env.FCM_PRIVATE_KEY), "RS256").catch(() => {
    throw new NotificationProviderError("misconfigured");
  });
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.FCM_CLIENT_EMAIL)
    .setSubject(env.FCM_CLIENT_EMAIL)
    .setAudience(googleTokenUrl)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60)
    .sign(key);

  let response: Response;
  try {
    response = await fetch(googleTokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
  } catch {
    throw new NotificationProviderError("unavailable");
  }
  const result = (await response.json().catch(() => null)) as {
    readonly access_token?: unknown;
    readonly expires_in?: unknown;
  } | null;
  if (
    !response.ok ||
    typeof result?.access_token !== "string" ||
    typeof result.expires_in !== "number"
  )
    throw new NotificationProviderError(response.status >= 500 ? "unavailable" : "misconfigured");

  fcmAuthorization = {
    credential,
    token: result.access_token,
    expiresAt: now + Math.max(0, result.expires_in - 300),
  };
  return result.access_token;
}

async function sendApns(
  env: Env,
  device: NotificationDevice,
  input: NotificationInput,
): Promise<ProviderResult> {
  if (env.APNS_BUNDLE_ID === undefined) throw new NotificationProviderError("misconfigured");
  const authorization = await apnsBearerToken(env);
  const host =
    device.environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  let response: Response;
  try {
    response = await fetch(`${host}/3/device/${encodeURIComponent(device.push_token)}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${authorization}`,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-topic": env.APNS_BUNDLE_ID,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(input.data === undefined ? {} : input.data),
        aps: {
          alert: { title: input.title, body: input.body },
          sound: "default",
        },
      }),
    });
  } catch {
    throw new NotificationProviderError("unavailable");
  }
  if (response.ok) return { messageId: response.headers.get("apns-id") ?? crypto.randomUUID() };

  const result = (await response.json().catch(() => null)) as { readonly reason?: unknown } | null;
  const invalidToken =
    result?.reason === "BadDeviceToken" ||
    result?.reason === "DeviceTokenNotForTopic" ||
    result?.reason === "Unregistered";
  throw new NotificationProviderError(
    response.status >= 500 || response.status === 429 ? "unavailable" : "rejected",
    invalidToken,
  );
}

async function sendFcm(
  env: Env,
  device: NotificationDevice,
  input: NotificationInput,
): Promise<ProviderResult> {
  if (env.FCM_PROJECT_ID === undefined) throw new NotificationProviderError("misconfigured");
  const authorization = await fcmBearerToken(env);
  let response: Response;
  try {
    response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FCM_PROJECT_ID)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${authorization}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: device.push_token,
            notification: { title: input.title, body: input.body },
            ...(input.data === undefined
              ? {}
              : {
                  data: Object.fromEntries(
                    Object.entries(input.data).map(([key, value]) => [
                      key,
                      typeof value === "string" ? value : JSON.stringify(value),
                    ]),
                  ),
                }),
            android: { notification: { sound: "default", channel_id: "default" } },
          },
        }),
      },
    );
  } catch {
    throw new NotificationProviderError("unavailable");
  }
  const result = (await response.json().catch(() => null)) as {
    readonly name?: unknown;
    readonly error?: {
      readonly status?: unknown;
      readonly details?: ReadonlyArray<{ readonly errorCode?: unknown }>;
    };
  } | null;
  if (response.ok && typeof result?.name === "string") return { messageId: result.name };

  const invalidToken =
    result?.error?.status === "NOT_FOUND" ||
    result?.error?.details?.some(
      (detail) => detail.errorCode === "UNREGISTERED" || detail.errorCode === "SENDER_ID_MISMATCH",
    ) === true;
  throw new NotificationProviderError(
    response.status >= 500 || response.status === 429 ? "unavailable" : "rejected",
    invalidToken,
  );
}

export function notificationDeviceId(pathname: string): string | null {
  const match = /^\/api\/v1\/devices\/([^/]+)\/push-token$/u.exec(pathname);
  const deviceId = match?.[1];
  return deviceId !== undefined && deviceIdPattern.test(deviceId) ? deviceId : null;
}

export async function handleNotificationDeviceRegister(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  const input = notificationDeviceInput(await requestBody(request));
  if (input === null) return jsonError(400, "bad_request");

  await env.DOMAINS.batch([
    env.DOMAINS.prepare(
      "DELETE FROM notification_devices WHERE push_token = ? AND device_id <> ?",
    ).bind(input.pushToken, deviceId),
    env.DOMAINS.prepare(
      `INSERT INTO notification_devices
         (device_id, user_id, organization_id, push_token, platform, environment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         user_id = excluded.user_id,
         organization_id = excluded.organization_id,
         push_token = excluded.push_token,
         platform = excluded.platform,
         environment = excluded.environment,
         updated_at = excluded.updated_at`,
    ).bind(
      deviceId,
      auth.userId,
      auth.organizationId,
      input.pushToken,
      input.platform,
      input.environment,
      Date.now(),
    ),
  ]);
  return new Response(null, { status: 204 });
}

export async function handleNotificationDeviceDelete(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth.ok) return authErrorResponse(auth);
  await env.DOMAINS.prepare("DELETE FROM notification_devices WHERE device_id = ? AND user_id = ?")
    .bind(deviceId, auth.userId)
    .run();
  return new Response(null, { status: 204 });
}

export async function handleNotificationSend(request: Request, env: Env): Promise<Response> {
  if (env.NOTIFICATION_API_KEY === undefined) return jsonError(503, "server_misconfigured");
  if (request.headers.get("authorization") !== `Bearer ${env.NOTIFICATION_API_KEY}`)
    return jsonError(401, "unauthorized");

  const input = notificationInput(await requestBody(request));
  if (input === null) return jsonError(400, "bad_request");
  const device = await env.DOMAINS.prepare(
    "SELECT push_token, platform, environment FROM notification_devices WHERE device_id = ?",
  )
    .bind(input.deviceId)
    .first<NotificationDevice>();
  if (device === null) return jsonError(404, "device_not_found");

  try {
    const result =
      device.platform === "ios"
        ? await sendApns(env, device, input)
        : await sendFcm(env, device, input);
    return jsonResponse({ messageId: result.messageId }, 202);
  } catch (error) {
    if (!(error instanceof NotificationProviderError)) throw error;
    if (error.invalidToken)
      await env.DOMAINS.prepare(
        "DELETE FROM notification_devices WHERE device_id = ? AND push_token = ?",
      )
        .bind(input.deviceId, device.push_token)
        .run();
    return error.kind === "misconfigured"
      ? jsonError(503, "server_misconfigured")
      : error.kind === "unavailable"
        ? jsonError(503, "notification_service_unavailable")
        : jsonError(502, "notification_rejected");
  }
}
