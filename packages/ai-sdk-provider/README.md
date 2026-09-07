# @runjobsai/ai-sdk-provider

[Vercel AI SDK](https://ai-sdk.dev) provider for the [RunJobs AI Gateway](https://github.com/runjobsai/ai-gateway), built on [`@runjobsai/sdk`](https://github.com/runjobsai/sdk-js).

Every model in the runjobs catalog — Claude, GPT, Gemini, DeepSeek, Qwen, MiniMax, GLM, Grok — works with `generateText`, `streamText`, `generateObject`, `Agent`, `useChat`, and the rest of the AI SDK ecosystem.

## Why not just point `@ai-sdk/openai-compatible` at the gateway?

You can. The gateway speaks the OpenAI Chat Completions wire format, so a stock OpenAI-compatible provider works — **if the user has already minted an `rk_…` key.**

That key is the whole problem in the browser. It can't be shipped in a bundle, so the usual answer is "proxy it through your own backend", which means there's no longer such a thing as a static, client-only AI app.

This package removes that step. With `authProvider: "runjobs"` there is no key to mint and nothing to keep secret:

```ts
const runjobs = createRunJobs({ authProvider: "runjobs" });
```

The SDK runs the runjobs.ai grant handshake, persists and silently refreshes the token, and shows the signed-in user's identity badge. Your bundle ships as static files.

Everything else — the protocol mapping, tool calling, streaming, structured outputs — is `@ai-sdk/openai-compatible`'s, maintained upstream. This package is the ~200 lines that make runjobs auth, cost reporting and server tools work through it.

## Install

```bash
pnpm add @runjobsai/ai-sdk-provider @runjobsai/sdk ai
```

ESM only — bundle it (Vite, Next, Rollup) or import it from Node 18+.

## Quick start

### Browser — no API key

```ts
import { createRunJobs } from "@runjobsai/ai-sdk-provider";
import { streamText } from "ai";

const runjobs = createRunJobs({ authProvider: "runjobs" });

const { textStream } = streamText({
  model: runjobs("Claude Sonnet 4.6"),
  prompt: "Explain async iterators in one sentence.",
});

for await (const chunk of textStream) console.log(chunk);
```

The first call redirects to the runjobs.ai grant page. After that the token is cached and refreshed on its own.

### Server — with an API key

```ts
const runjobs = createRunJobs({ apiKey: process.env.RUNJOBS_API_KEY });
```

### Isomorphic (Next.js and friends)

One module, imported by both the SSR render and the browser bundle:

```ts
export const runjobs = createRunJobs({
  authProvider: "runjobs",
  apiKey: process.env.RUNJOBS_API_KEY, // used only where there's no window
});
```

Browser auth is used wherever it can actually work; on the server the key takes over.

## Agents

The reason to run through the AI SDK at all — multi-step tool loops, with the gateway handling the model:

```ts
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const { text } = await generateText({
  model: runjobs("Claude Sonnet 4.6"),
  prompt: "What's the weather in Shanghai? Then suggest what to wear.",
  tools: {
    weather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, celsius: 22 }),
    }),
  },
  stopWhen: stepCountIs(5),
});
```

## Server tools

The gateway can run web search and content fetching _itself_, looping with the model until it has an answer — no round trip to your code, and no search infrastructure to wire up. Mix freely with your own `tools`: the model can call either.

```ts
const { text, providerMetadata } = await generateText({
  model: runjobs("Claude Sonnet 4.6"),
  prompt: "What is the latest stable Go version?",
  providerOptions: {
    runjobs: {
      serverTools: ["web_search", "web_fetch"],
      maxServerIterations: 5,
    },
  },
});
```

Available: `web_search` (Brave), `web_fetch` (free), `twitter_search`.

Set them once for every call instead:

```ts
const runjobs = createRunJobs({
  authProvider: "runjobs",
  serverTools: ["web_search"],
});
```

Per-call `providerOptions.runjobs` wins over the provider-level default.

## Cost

`LanguageModelV4Usage` only carries token counts, so the gateway's USD billing arrives as provider metadata:

```ts
const { providerMetadata } = await generateText({ model: runjobs("Claude Sonnet 4.6"), prompt: "hi" });

providerMetadata?.runjobs.totalCost; // 0.0123 — model spend + every server-tool charge
providerMetadata?.runjobs.toolCosts; // [{ name: "web_search", count: 2, cost: 0.01 }]
```

Streaming works the same way — `await result.providerMetadata` after the stream drains.

## Beyond the AI SDK

The AI SDK has no interface for a lot of what the gateway does. `provider.client` is the full `@runjobsai/sdk` client, sharing one token, one event bus and one badge with everything above:

```ts
await runjobs.client.video.generate("MiniMax Hailuo 2.3", { prompt: "a gentle ocean wave" });
await runjobs.client.files.putString("notes.md", "# hello");
await runjobs.client.computer.step("AI Control", { messages, display_width: 1920, display_height: 1080 });

const models = await runjobs.client.models.list({ capability: "text" });
```

Reuse a client you already built, rather than starting a second grant flow and painting a second badge:

```ts
import { RunJobs } from "@runjobsai/sdk";

const client = new RunJobs({ authProvider: "runjobs" });
const runjobs = createRunJobs({ client });
```

## Auth surface

```ts
runjobs.user; // { id, name } | null
runjobs.signIn(); // force the grant redirect
runjobs.signOut(); // clear the cached token + identity
```

## Telemetry

AI SDK traffic fires the same `client.events` the SDK's own services do, so the identity badge's activity ring animates for `streamText` exactly as it does for `client.chat.stream`:

```ts
runjobs.events.on("request:end", (e) => {
  console.log(e.model, e.latencyMs, e.costUSD);
});
```

Events: `request:start`, `request:streamDelta`, `request:end`, `request:error`.

## API

| Export                       | Description                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRunJobs(settings)`    | Build a provider. Takes every `@runjobsai/sdk` `ClientOptions` field plus `client`, `serverTools`, `maxServerIterations`, `headers`, `includeUsage`. |
| `runjobs`                    | Zero-config browser provider — `createRunJobs({ authProvider: "runjobs" })`, constructed lazily on first use.                                        |
| `createAuthedFetch(options)` | The auth + telemetry `fetch` on its own, for wiring runjobs auth into some other AI SDK provider.                                                    |
| `runjobsMetadataExtractor`   | The cost metadata extractor, likewise.                                                                                                               |

| Provider member                                         | Description                                     |
| ------------------------------------------------------- | ----------------------------------------------- |
| `runjobs(id)` / `.languageModel(id)` / `.chatModel(id)` | `LanguageModelV4`                               |
| `.embeddingModel(id)`                                   | `EmbeddingModelV4`                              |
| `.imageModel(id)`                                       | `ImageModelV4`                                  |
| `.client`                                               | The underlying `@runjobsai/sdk` client          |
| `.events`                                               | Telemetry bus (same object as `.client.events`) |
| `.user` / `.signIn()` / `.signOut()`                    | Browser auth surface                            |

Model IDs are whatever `/v1/models` lists — `"Claude Sonnet 4.6"`, `"Gemini 3 Flash"`, and so on. Browse the live catalog with `runjobs.client.models.list()`; no auth needed.

## Development

This package lives in a pnpm workspace. The repository root is the browser
test harness that consumes it — see the [root README](../../README.md) for
the layout and the workspace-level scripts.

```
src/               the library
tests/             vitest suite
tsdown.config.ts   the build
```

```bash
pnpm build       # src/ → dist/ (ESM + declarations)
pnpm typecheck   # tsc --noEmit; the build emits the types
pnpm test        # build + vitest — request shaping, auth, agent loop
pnpm test:watch  # vitest in watch mode
```

`pnpm build` is [tsdown](https://tsdown.dev): bundle and declarations in one
pass, no dts plugin and no second `tsc` run to keep in step with the first.

Dependencies are never bundled — tsdown externalizes `dependencies` and
`peerDependencies` by default, so adding one can't silently start baking it
into `dist/`. `tests/build.test.ts` asserts that against the built artifact,
because the failure mode is quiet: the build prints success and emits a
`dist/` that looks right until someone installs it.

The suite runs against `src/`, not `dist/` — `vitest.config.ts` aliases the
package's own name back to the source, so a behaviour test never waits on a
build. `tests/build.test.ts` is the exception and reads `dist/`, which is
why `pnpm test` builds first.

What matters most can't be tested from Node at all: the browser sign-in
flow needs a window to redirect and a `localStorage` to cache a token in.
That's what the labs at the repo root are for — `pnpm dev` there runs a
React app with one page per feature (catalog, generateText, streamText,
`useChat` with no backend, tool loops, server tools, structured output,
embeddings), each showing its own source, over a live view of the
`request:*` event bus.

> Browser sign-in redirects to `https://www.runjobs.ai/api/sdk/grant` and
> returns to the page origin. If `localhost:5173` isn't a registered
> `(origin, app)` pair on the gateway, pin the grant to a project with
> the **Project** field (equivalent to `createRunJobs({ authProvider:
> "runjobs", project: "proj_…" })`).

## Not yet wired up

`ProviderV4` has optional `speechModel`, `transcriptionModel` and `files` slots that map almost one-to-one onto `client.audio.speech`, `client.audio.transcribe` and `client.files`. They aren't implemented yet — use `provider.client` for those in the meantime.

## License

MIT
