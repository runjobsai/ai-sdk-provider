import type { HighlighterCore } from "shiki/core";

/**
 * Syntax highlighting for the source panel under each lab.
 *
 * Everything here is loaded on demand: the grammar and both themes are
 * several hundred kB, and a visitor who never opens a source panel
 * should not pay for them. The dynamic imports mean Vite emits them as
 * a separate chunk.
 *
 * Two themes are rendered at once. Shiki writes the dark colours into
 * `--shiki-dark` custom properties alongside the light ones, and one
 * CSS rule in `index.css` switches between them, so highlighting
 * follows the same `prefers-color-scheme` the rest of the page does
 * without re-highlighting on a theme change.
 */

let highlighter: Promise<HighlighterCore> | undefined;

function load(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, tsx, light, dark] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("shiki/langs/tsx.mjs"),
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ]);

    return createHighlighterCore({
      langs: [tsx],
      themes: [light, dark],
      // The JavaScript engine avoids shipping the Oniguruma wasm blob.
      // TSX is well within what it handles.
      engine: createJavaScriptRegexEngine(),
    });
  })();

  return highlighter;
}

/** Highlight a lab's source. Returns HTML for a `<pre>` wrapper. */
export async function highlightTsx(code: string): Promise<string> {
  const shiki = await load();
  return shiki.codeToHtml(code, {
    lang: "tsx",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}
