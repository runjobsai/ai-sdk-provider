import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Guards on the published artifact rather than on behaviour — the other
 * suite runs against `lib/` source, so nothing else would notice if the
 * build config broke.
 *
 * Both failure modes here are silent: the build prints success and emits
 * a `dist/` that looks right until someone installs it. Requires `pnpm
 * build` first, which `pnpm test` does.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const pkg = JSON.parse(read("../package.json"));
const bundle = read("../dist/index.js");
const map = JSON.parse(read("../dist/index.js.map"));

/** Static import/export specifiers in the emitted ESM. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

test("bundles no dependency code — every specifier stays an import", () => {
  // Vite's lib mode externalizes nothing on its own: drop
  // `build.rollupOptions.external` and all seven transitive packages,
  // peerDependencies included, get inlined into dist/index.js.
  const inlined = (map.sources as string[]).filter((s) => s.includes("node_modules"));
  expect(inlined, `these dependencies were inlined:\n  ${inlined.join("\n  ")}`).toEqual([]);
});

test("emits only bare specifiers, resolved by the host app", () => {
  const local = specifiers(bundle).filter((s) => s.startsWith(".") || s.startsWith("/"));
  expect(local, "the ESM build must not reference files outside the package entry").toEqual([]);
});

test("every runtime import is a declared dependency", () => {
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);

  for (const spec of specifiers(bundle)) {
    if (spec.startsWith("node:")) continue;
    // `pkg/sub/path` is still the `pkg` (or `@scope/pkg`) dependency.
    const parts = spec.split("/");
    const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
    expect(
      declared.has(name),
      `dist/index.js imports "${spec}" but "${name}" is in neither dependencies nor peerDependencies`,
    ).toBe(true);
  }
});

test("ships type declarations for the entry point", () => {
  const dts = read("../dist/index.d.ts");
  expect(dts).toMatch(/createRunJobs/);
  expect(dts).toMatch(/RunJobsProvider/);
  expect(pkg.types).toBe("./dist/index.d.ts");
  expect(pkg.exports["."].types).toBe("./dist/index.d.ts");
});
