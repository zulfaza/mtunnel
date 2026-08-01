import { Analytics } from "@tunnel/core";
import { Effect } from "effect";
import { runCore } from "./runtime.js";
import type { Env } from "./env.js";

export type AnalyticsProperties = Readonly<Record<string, string | number | boolean | undefined>>;

export interface AnalyticsEvent {
  readonly event: string;
  readonly distinctId?: string;
  readonly organizationId?: string;
  readonly properties?: AnalyticsProperties;
}

export async function capture(env: Env, input: AnalyticsEvent): Promise<void> {
  await runCore(
    env,
    Effect.gen(function* () {
      const analytics = yield* Analytics.Analytics;
      yield* analytics.capture(input);
    }),
  );
}
