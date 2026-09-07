import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Serves the browser labs: `index.html` + `src/`, with the provider
// resolved to `packages/ai-sdk-provider/src` by the `paths` entry in
// `tsconfig.json`. The library builds itself, with tsdown.
export default defineConfig({
  plugins: [react()],

  resolve: { tsconfigPaths: true },

  server: { port: 5173, strictPort: true },

  build: {
    target: "es2022",
    sourcemap: true,
  },
});
