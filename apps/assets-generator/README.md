# Asset generator

Deterministic HTML and React image templates.

## Use

```sh
pnpm --filter @tunnel/assets-generator dev
pnpm --filter @tunnel/assets-generator generate -- --template og
pnpm --filter @tunnel/assets-generator generate -- --template og --output apps/landing/static/og.png
pnpm --filter @tunnel/assets-generator generate -- --template dashboard-og --output apps/dashboard/public/og.png
```

The default output is `apps/assets-generator/generated/<template>.png`. Chrome or Chromium is required. Register React components or imported HTML files in `src/templates.tsx`.
