import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    plugins: ["typescript", "unicorn"],
    categories: {
      correctness: "error",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "typescript/no-explicit-any": "error",
      eqeqeq: "error",
      "no-console": "off",
      "no-underscore-dangle": "off",
      "no-await-in-loop": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: false,
      typeCheck: false,
    },
    ignorePatterns: [
      "dist/**",
      "node_modules/**",
      ".wrangler/**",
      "bin/**",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
    ],
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
});
