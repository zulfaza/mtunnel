import type { Env } from "./env.js";

export type AnalyticsProperties = Readonly<Record<string, string | number | boolean | undefined>>;

interface AnalyticsEvent {
  readonly event: string;
  readonly distinctId?: string;
  readonly organizationId?: string;
  readonly properties?: AnalyticsProperties;
}

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export async function capture(env: Env, input: AnalyticsEvent): Promise<void> {
  if (env.POSTHOG_API_KEY === undefined || env.POSTHOG_API_KEY === "") return;

  const properties = Object.fromEntries(
    Object.entries(input.properties ?? {}).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
    ),
  );

  try {
    const host = (env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST).replace(/\/+$/u, "");
    const response = await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event: input.event,
        properties: {
          ...properties,
          distinct_id: input.distinctId ?? crypto.randomUUID(),
          ...(input.organizationId === undefined
            ? { $process_person_profile: false }
            : {
                organization_id: input.organizationId,
                $groups: { organization: input.organizationId },
              }),
          $geoip_disable: true,
        },
      }),
    });
    await response.body?.cancel();
    if (!response.ok) console.warn("PostHog rejected analytics event", response.status);
  } catch (error) {
    console.warn("Failed to deliver PostHog analytics event", error);
  }
}
