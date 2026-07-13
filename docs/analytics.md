# Product analytics

The edge Worker sends operational product events to PostHog. Analytics is disabled when
`POSTHOG_API_KEY` is absent, and delivery failures never fail a tunnel request.

## Configure PostHog

Create a PostHog project, copy its project API key, and add it as a Worker secret:

```sh
cd apps/edge
pnpm exec wrangler secret put POSTHOG_API_KEY
```

`POSTHOG_HOST` defaults to the US ingestion host and is set in `wrangler.jsonc`. For an EU
project, change it to `https://eu.i.posthog.com`. Deploy the Worker and release the updated CLI;
both are required for OS and config-source data.

## Events

`tunnel connected` represents an active user and organization. It includes the WorkOS user and
organization IDs, a connection-scoped `$session_id`, project-config versus terminal usage, agent
version, OS, and Cloudflare-derived country, region, city, timezone, and colo.

`tunnel request completed` measures session utilization. It includes route type, custom-domain
usage, method, status, duration, byte counts, success, and a low-cardinality error code. It does
not include request URLs, headers, local upstream addresses, IP addresses, tokens, or config paths.

## Suggested insights

Use `tunnel connected` as the activity event for these insights:

- Daily active users: unique users, daily interval. This applies WorkOS's "any user action"
  active-user standard to a day; opening a tunnel is the qualifying product action.
- Active organizations: unique `organization_id` values over the selected period.
- Average active members per active organization: count unique `(organization_id, person_id)`
  pairs and divide by unique `organization_id` values over the same period.
- Usage time: hourly distribution of `tunnel connected`, broken down by `timezone` or `country`.
- Session utilization: total and average `tunnel request completed` events grouped by
  `$session_id`; chart `duration_ms`, `request_bytes`, `response_bytes`, `success`, and `status`.
- Custom domains: percentage of `tunnel request completed` where `used_custom_domain` is true.
- Config adoption: `tunnel connected` broken down by `usage_source`.
- Geography and OS: `tunnel connected` broken down by `country`, `region`, and
  `operating_system`.

An organization is considered active only when one of its members opens a tunnel. "Average active
members" intentionally measures members who used the product during the selected period. The
total number of provisioned WorkOS memberships is a different metric and requires syncing WorkOS
membership lifecycle events into PostHog.
