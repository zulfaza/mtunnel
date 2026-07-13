import type { Env } from "./env.js";

export type AnalyticsProperties = Readonly<Record<string, string | number | boolean | undefined>>;

interface AnalyticsEvent {
  readonly event: string;
  readonly distinctId: string;
  readonly organizationId: string;
  readonly properties?: AnalyticsProperties;
}

export async function capture(env: Env, input: AnalyticsEvent): Promise<void> {
  if (env.POSTHOG_API_KEY === undefined) return;
  const properties = Object.fromEntries(
    Object.entries(input.properties ?? {}).filter((entry): entry is [string, string | number | boolean] =>
      entry[1] !== undefined,
    ),
  );
  try {
    await fetch(`${env.POSTHOG_HOST ?? "https://us.i.posthog.com"}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event: input.event,
        properties: {
          ...properties,
          distinct_id: input.distinctId,
          organization_id: input.organizationId,
          $groups: { organization: input.organizationId },
          $geoip_disable: true,
        },
      }),
    });
  } catch {
    // Analytics must never affect tunnel availability.
  }
}
