import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The behaviour suite imports the package by its published name but
      // runs against `src/` — the same code, without a build in between.
      // `tests/build.test.ts` is the one that reads `dist/` instead.
      "@runjobsai/ai-sdk-provider": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
