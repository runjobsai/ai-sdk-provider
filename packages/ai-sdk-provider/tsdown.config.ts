import { defineConfig } from "tsdown";

// Builds `src/` into `dist/` — ESM plus declarations, in one pass.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // Neither Node- nor browser-specific: the provider runs in both, and
  // the only globals it touches (`fetch`, `URL`) exist either side.
  platform: "neutral",
  target: "es2022",
  dts: true,
  // Nothing from node_modules is ever bundled. tsdown externalizes
  // `dependencies` and `peerDependencies` on its own; `neverBundle`
  // extends that to every bare specifier, so a package that is missing
  // from `package.json` — or landed in `devDependencies` by mistake —
  // fails loudly as an undeclared import instead of being quietly
  // inlined. `tests/build.test.ts` asserts both halves of that against
  // the emitted artifact.
  deps: { neverBundle: true },
  sourcemap: true,
  clean: true,
  treeshake: true,
});
