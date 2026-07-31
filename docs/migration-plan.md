# Monorepo migration & tidy plan

Target layout:

```
apps/
  cli/        # Go agent (was agents/tunnel)
  api/        # Cloudflare Worker (was apps/edge)
  landing/    # Svelte marketing site (new)
  dashboard/  # TanStack + shadcn app: billing, assets, config (new)
packages/
  config/     # unchanged
  protocol/   # unchanged
  tsconfig/   # unchanged
  assets/     # NEW: shared brand assets (logo, icons, fonts, og images)
              # consumed by landing + dashboard; optionally design tokens/CSS vars
```

## Phase 0 — prep

- Land in-flight preview work first (uncommitted changes in `apps/edge`,
  `agents/tunnel`, migrations, docs). Migrating on top of a dirty tree makes
  rebases painful.
- Do each phase as its own PR. Use `git mv` to preserve history.

## Phase 1 — agents/tunnel → apps/cli

- `git mv agents/tunnel apps/cli`, drop the now-empty `agents/`.
- Update `go.mod` module path to `github.com/zulfaza/mtunnel/apps/cli` and
  rewrite internal imports (`grep -rl` + `sed` across `*.go`).
- pnpm ignores dirs without `package.json`, so the Go app won't break the
  workspace. Optional: add a thin `package.json` (`@tunnel/cli`) whose
  `build`/`test` scripts call `make`, so `turbo build` covers the CLI too.
- Update references:
  - root `package.json`: `build:agent`, `test:agent` paths.
  - `.github/workflows/ci.yml`: `go-version-file`, `make -C` paths (agent + e2e jobs).
  - `.github/workflows/release.yml`: `working-directory`, artifact paths.
  - `scripts/e2e.mjs`: `agents/tunnel/bin/mt`, `make -C agents/tunnel`.
  - Docs mentioning `agents/tunnel` (README, AGENTS.md, docs/*).

## Phase 2 — apps/edge → apps/api

- `git mv apps/edge apps/api`; rename package `@tunnel/edge` → `@tunnel/api`.
- KEEP `wrangler.jsonc` `name: "tunnel-edge"` (or decide explicitly): renaming
  the Worker creates a NEW worker — Durable Object state (TunnelDO, RegistryDO),
  D1, and R2 bindings/routes would need migration. Directory/package rename is
  safe; worker rename is a separate, risky decision.
- Update references:
  - root `package.json`: `dev:edge` → `dev:api`, `test:edge` → `test:api`,
    turbo `--filter=@tunnel/api`.
  - `.github/workflows/ci.yml`: `.dev.vars` copy path, deploy `working-directory`.
  - `scripts/e2e.mjs`: `apps/edge` paths.
  - Docs (deployment.md, development.md, architecture.md, README, AGENTS.md).

## Phase 3 — packages/assets (shared assets)

- New workspace package `@tunnel/assets`: logo/wordmark (SVG), favicons,
  fonts, og-image sources; optionally shared design tokens (CSS variables)
  so landing and dashboard stay visually consistent.
- Exported via `package.json` `exports` (static files + optional `tokens.css`).
- Both landing and dashboard depend on it `workspace:*`; Vite imports the
  files directly, no build step needed.

## Phase 4 — apps/landing (Svelte)

- Scaffold SvelteKit with the Cloudflare adapter (deploys as a Worker with
  static assets); package `@tunnel/landing`.
- Wire turbo tasks (`dev`, `build`, `lint`, `typecheck`), shared tsconfig.
- Content: hero, features, install instructions (`mt` binary), pricing, links
  to dashboard/docs.
- Deploy: own Worker (`tunnel-landing`), CI deploy job after tests.
- Domain: TBD — root domain currently belongs to the tunnel Worker, which
  derives tunnel IDs from hostnames. Landing likely goes on apex/www with the
  API on a subdomain or wildcard-only routes. Decide routing before deploy.

## Phase 5 — apps/dashboard (TanStack + shadcn)

- Scaffold TanStack Start (React) + Tailwind + shadcn/ui; package
  `@tunnel/dashboard`; Cloudflare Workers deploy target.
- Sections: billing, assets (preview artifacts in R2), config (tunnels,
  custom domains, tokens).
- Depends on API surface: current auth is a single root secret — a real
  dashboard needs accounts/sessions and per-user tokens in the API first.
  Scaffold + read-only views can land before billing.
- Deploy: own Worker (`tunnel-dashboard`), e.g. `dash.<domain>`.

## Phase 6 — tidy

- Root scripts: consistent `dev:<app>` / `test:<app>` per app.
- turbo.json: add `deploy` task if useful; ensure new apps cached correctly.
- CI: matrix or per-app jobs; only deploy apps whose files changed (optional).
- Docs pass: architecture.md diagram, deployment.md, README paths.

## Open questions (blockers marked *)

1. *Worker name: keep `tunnel-edge` deployed name, or rename to `tunnel-api`
   and migrate DO/D1/routes?
2. *Domain layout: which hostnames get landing / dashboard / API? Tunnel
   hostname-derivation constrains this.
3. Billing: provider (Stripe?), and is there a user/account model yet, or
   scaffold-only for now?
4. TanStack Start (SSR) vs TanStack Router SPA?
5. SvelteKit vs plain Svelte+Vite for landing?
6. Go module path rename to `.../apps/cli` OK? (breaks `go install` paths if
   anyone imports it.)
