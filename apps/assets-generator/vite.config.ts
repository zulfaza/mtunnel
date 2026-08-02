import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  base: "./",
  plugins: lazyPlugins(() => [react()]) ?? [],
});
