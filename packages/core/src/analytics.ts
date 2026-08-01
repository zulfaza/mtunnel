import { Context, Effect, Layer } from "effect";
import { CoreConfig } from "./config.js";

export type AnalyticsProperties = Readonly<Record<string, string | number | boolean | undefined>>;

export interface AnalyticsEvent {
  readonly event: string;
  readonly distinctId?: string;
  readonly organizationId?: string;
  readonly properties?: AnalyticsProperties;
}

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export class Analytics extends Context.Service<
  Analytics,
  { readonly capture: (input: AnalyticsEvent) => Effect.Effect<void> }
>()("@tunnel/core/analytics/Analytics") {}

export const analyticsLayer = Layer.effect(
  Analytics,
  Effect.gen(function* () {
    const config = yield* CoreConfig;
    const capture = Effect.fn("analytics.capture")(function* (input: AnalyticsEvent) {
      if (config.posthogApiKey === undefined || config.posthogApiKey === "") return;
      const properties = Object.fromEntries(
        Object.entries(input.properties ?? {}).filter(
          (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
        ),
      );
      yield* Effect.promise(async () => {
        try {
          const host = (config.posthogHost ?? DEFAULT_POSTHOG_HOST).replace(/\/+$/u, "");
          const response = await fetch(`${host}/capture/`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              api_key: config.posthogApiKey,
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
      });
    });
    return Analytics.of({ capture });
  }),
);
