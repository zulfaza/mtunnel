import { Context } from "effect";

export interface CoreConfigShape {
  readonly tunnelDomain: string;
  readonly previewDomain: string;
  readonly customDomainCname: string;
  readonly workosClientId: string;
  readonly workosApiKey?: string;
  readonly cloudflareApiToken?: string;
  readonly cloudflareZoneId?: string;
  readonly authSecret?: string;
  readonly authMode?: string;
  readonly devAuthSecret?: string;
  readonly posthogApiKey?: string;
  readonly posthogHost?: string;
  readonly maximumPreviewFileBytes?: number;
  readonly maximumPreviewFiles?: number;
  readonly previewTtlSeconds?: number;
}

export class CoreConfig extends Context.Service<CoreConfig, CoreConfigShape>()(
  "@tunnel/core/config/CoreConfig",
) {}
