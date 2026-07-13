import type { AnalyticsProperties } from "../analytics.js";

export interface TrackedEvent {
  readonly event: string;
  readonly properties?: AnalyticsProperties;
}
