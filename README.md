# @runjobsai/ai-sdk-provider — workspace

A pnpm workspace with two halves: the published library, and a React app of
runnable labs for it.

```
packages/ai-sdk-provider/   the library — published to npm as @runjobsai/ai-sdk-provider
index.html, src/            the labs — React 19 + Vite, private, never published
```

Each lab is one file under `src/labs/`, demonstrating one thing, and the page
shows you its own source next to it. In order:

| # | Lab | What it demonstrates |
| - | --- | -------------------- |
| 01 | Model catalog | `provider.client` — the escape hatch. Needs no auth. |
| 02 | generateText | The plain one-shot call, plus cost from `providerMetadata` |
| 03 | streamText | `textStream`, and cancelling with an `AbortSignal` |
| 04 | useChat | A real chat UI **with no backend** — see below |
| 05 | Tool loop | `generateText({ tools })` with every step inspectable |
| 06 | Server tools | `web_search` / `web_fetch`, run by the gateway |
| 07 | Structured output | `streamObject` filling a zod schema as it streams |
| 08 | Embeddings | `embedMany` + `cosineSimilarity` |

### The one worth reading

`useChat` normally POSTs to your own `/api/chat`, which is the whole reason a
"static, client-only AI app" usually isn't one. Lab 04 passes it a
`DirectChatTransport` wrapping a `ToolLoopAgent` instead, so the entire loop —
including tool execution — runs in the tab:

```ts
const agent = new ToolLoopAgent({ model, tools: { weather }, stopWhen: stepCountIs(5) });
const { messages, sendMessage } = useChat({ transport: new DirectChatTransport({ agent }) });
```

No endpoint, no server, no key to hide. `useObject` and `useCompletion` can't
do this — they take an `api` URL and have no transport seam — which is why
lab 07 uses `streamObject` from core instead.

The library's own README is [`packages/ai-sdk-provider/README.md`](./packages/ai-sdk-provider/README.md);
that's the one npm shows.

## Setup

```bash
pnpm install
```

## Scripts

Run from the repository root:

```bash
pnpm dev         # the labs on http://localhost:5173
pnpm build       # library, then the labs
pnpm typecheck   # both projects
pnpm test        # library suite — build + vitest
```

Anything scoped to the library alone works with a filter, or from inside
`packages/ai-sdk-provider`:

```bash
pnpm --filter @runjobsai/ai-sdk-provider build
```

## How the two halves connect

The labs import the library by its published name, `@runjobsai/ai-sdk-provider`.
That name resolves to `packages/ai-sdk-provider/src/index.ts` — the source,
not `dist/` — through `paths` in the root `tsconfig.json`, which Vite reads
natively via `resolve.tsconfigPaths`. So editing the library hot-reloads the
page, there's no build step between the two, and the mapping is declared in
exactly one place.

The workspace link in `package.json` (`"@runjobsai/ai-sdk-provider": "workspace:*"`)
is what makes the dependency real to pnpm and keeps the import honest — it
would resolve to the built `dist/` on its own, and does for anyone who
installs the package for real.

## Publishing

```bash
pnpm --filter @runjobsai/ai-sdk-provider publish
```

`prepublishOnly` cleans, typechecks and rebuilds first, and `files` limits
the tarball to `dist/` plus the README.
