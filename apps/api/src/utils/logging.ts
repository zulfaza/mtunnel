/**
 * Structured logs intentionally exclude tokens, cookies, authentication headers,
 * request/response bodies, and query strings. Do not add those values here.
 */
export interface LogEvent {
  readonly event: string;
  readonly tunnelId?: string;
  readonly requestId?: string;
  readonly method?: string;
  readonly status?: number;
  readonly duration?: number;
  readonly bytesIn?: number;
  readonly bytesOut?: number;
  readonly error?: string;
}

export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify(event));
}
