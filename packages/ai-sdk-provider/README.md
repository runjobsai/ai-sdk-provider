# @runjobsai/ai-sdk-provider

**English** · [简体中文](./README.zh-CN.md)

A [Vercel AI SDK](https://ai-sdk.dev) provider for the [RunJobs AI Gateway](https://github.com/runjobsai/ai-gateway), built on [`@runjobsai/sdk`](https://github.com/runjobsai/sdk-js).

All models in the runjobs catalog (Claude, GPT, Gemini, DeepSeek, Qwen, MiniMax, GLM, Grok) are available through `generateText`, `streamText`, `generateObject`, `Agent`, `useChat` and the rest of the AI SDK ecosystem.

## Relationship to `@ai-sdk/openai-compatible`

The gateway implements the OpenAI Chat Completions wire format, so a standard OpenAI-compatible provider will work against it, provided an `rk_…` API key has already been issued.

That requirement is the limitation this package addresses. An API key cannot be shipped in a browser bundle, so the conventional solution is to proxy requests through a backend service, which rules out a purely static client-side application.

With `authProvider: "runjobs"`, no API key is involved:

```ts
const runjobs = createRunJobs({ authProvider: "runjobs" });
```

The SDK performs the runjobs.ai grant handshake, persists the resulting token, refreshes it silently, and renders the signed-in user's identity badge. The application can be deployed as static files.

Protocol mapping, tool calling, streaming and structured output are provided by `@ai-sdk/openai-compatible` and maintained upstream. This package supplies the authentication, cost reporting and server tool support required to use it against the runjobs gateway.

## Installation

```bash
pnpm add @runjobsai/ai-sdk-provider @runjobsai/sdk ai
```

The package is ESM only. Use it through a bundler (Vite, Next, Rollup) or import it directly from Node 18 or later.

## Usage

### Browser, without an API key

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

The first call redirects to the runjobs.ai grant page. The token is cached and refreshed automatically thereafter.

### Server, with an API key

```ts
const runjobs = createRunJobs({ apiKey: process.env.RUNJOBS_API_KEY });
```

### Isomorphic applications

A single module, imported by both the server render and the browser bundle:

```ts
export const runjobs = createRunJobs({
  authProvider: "runjobs",
  apiKey: process.env.RUNJOBS_API_KEY, // applies only where no window is available
});
```

Browser authentication takes precedence wherever it can operate. On the server, the API key is used instead.

## Client-side chat

By default `useChat` posts to an application endpoint such as `/api/chat`. Supplying a `DirectChatTransport` instead runs the conversation loop, including tool execution, entirely in the browser:

```tsx
import { useChat } from "@ai-sdk/react";
import { DirectChatTransport, ToolLoopAgent, stepCountIs } from "ai";

const agent = new ToolLoopAgent({
  model: runjobs("Claude Sonnet 4.6"),
  tools: { weather },
  stopWhen: stepCountIs(5),
});

const { messages, sendMessage } = useChat({
  transport: new DirectChatTransport({ agent }),
});
```

No server-side endpoint is required.

> `useObject` and `useCompletion` cannot be used this way. Both require an `api` URL and provide no transport abstraction, so both depend on a server. For structured output in the browser, use `streamObject` from `ai` core.

## Tool loops

Multi-step tool calling, with the gateway handling model access:

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

The gateway can perform web search and content retrieval itself, iterating with the model until it produces an answer. This requires no round trip to application code and no search infrastructure. Server tools can be combined with locally defined `tools`; the model may call either.

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

Available tools: `web_search` (Brave), `web_fetch` (no charge), `twitter_search`.

They can also be configured once, for every call:

```ts
const runjobs = createRunJobs({
  authProvider: "runjobs",
  serverTools: ["web_search"],
});
```

A per-call `providerOptions.runjobs` value overrides the provider-level default.

## Image generation

```ts
import { generateImage } from "ai";

const { image } = await generateImage({
  model: runjobs.imageModel("Seedream 4.0"),
  prompt: "a gentle ocean wave",
});

image.base64; // ready to render
```

Gateway parameters that have no AI SDK field travel through `providerOptions`.
Which parameters a model accepts, and the values valid for each, differ per
model and are advertised on `/v1/models`; read them with `getOptionsSchema` and
`allowedValuesFor` from `@runjobsai/sdk` rather than assuming:

```ts
await generateImage({
  model: runjobs.imageModel("Seedream 4.0"),
  prompt: "a gentle ocean wave",
  providerOptions: {
    runjobs: { resolution: "2k", style: "anime", reference_image_urls: ["https://…"] },
  },
});
```

Per-image extras come back on `providerMetadata`:

```ts
const meta = result.providerMetadata.runjobs.images[0];
meta.url; // the image's gateway URL, for display without re-encoding the bytes
meta.revisedPrompt;
meta.attribution; // credit line that stock-library models require you to display
```

`seed`, `files` and `mask` are not supported. Passing them returns a warning on
`result.warnings`; use `provider.client.image.edit()` for masked edits.

> Image cost is not in the result. Read `costUSD` from the `request:end` event
> instead (see [Telemetry](#telemetry)).

## Speech and transcription

```ts
import { experimental_generateSpeech as generateSpeech, experimental_transcribe as transcribe } from "ai";

const { audio } = await generateSpeech({
  model: runjobs.speechModel("CosyVoice"),
  text: "Good morning.",
  voice: "nova",
});

const { text, segments } = await transcribe({
  model: runjobs.transcriptionModel("Whisper"),
  audio: bytes,
});
```

The AI SDK's field names are not the gateway's: `instructions` is sent as
`instruct_text` and `outputFormat` as `response_format`. Voice controls the
gateway adds on top, such as `emotion`, `pitch`, `volume` and `timber`, have no
AI SDK field and go through `providerOptions`:

```ts
providerOptions: { runjobs: { emotion: "happy", pitch: 3 } }
```

`segments`, `language` and `durationInSeconds` are only populated when the model
returns a verbose transcript, which is requested the same way:

```ts
providerOptions: { runjobs: { response_format: "verbose_json" } }
```

Which fields a given model accepts is advertised on `/v1/models`; read them with
`getOptionsSchema` and `allowedValuesFor` from `@runjobsai/sdk`.

Streaming transcription is not mapped. Use `provider.client.audio` for it.

## Cost reporting

`LanguageModelV4Usage` carries token counts only, so the gateway reports billing as provider metadata:

```ts
const { providerMetadata } = await generateText({ model: runjobs("Claude Sonnet 4.6"), prompt: "hi" });

providerMetadata?.runjobs.totalCost; // 0.0123, model spend plus all server tool charges
providerMetadata?.runjobs.toolCosts; // [{ name: "web_search", count: 2, cost: 0.01 }]
```

Streaming behaves the same way. Await `result.providerMetadata` once the stream has drained.

## Direct SDK access

The AI SDK defines no interface for several gateway capabilities. `provider.client` exposes the underlying `@runjobsai/sdk` client, which shares a single token, event bus and identity badge with the provider:

```ts
await runjobs.client.video.generate("MiniMax Hailuo 2.3", { prompt: "a gentle ocean wave" });
await runjobs.client.files.putString("notes.md", "# hello");
await runjobs.client.computer.step("AI Control", { messages, display_width: 1920, display_height: 1080 });

const models = await runjobs.client.models.list({ capability: "text" });
```

An existing client can be reused, which avoids initiating a second grant flow and rendering a second badge:

```ts
import { RunJobs } from "@runjobsai/sdk";

const client = new RunJobs({ authProvider: "runjobs" });
const runjobs = createRunJobs({ client });
```

## Authentication

```ts
runjobs.user; // { id, name } | null
runjobs.signIn(); // initiate the grant redirect
runjobs.signOut(); // clear the cached token and identity
```

## Telemetry

AI SDK requests emit the same `client.events` as the SDK's own services, so the identity badge reflects `streamText` activity exactly as it does `client.chat.stream`:

```ts
runjobs.events.on("request:end", (e) => {
  console.log(e.model, e.latencyMs, e.costUSD);
});
```

Events: `request:start`, `request:streamDelta`, `request:end`, `request:error`.

## API reference

| Export                       | Description                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRunJobs(settings)`    | Constructs a provider. Accepts all `@runjobsai/sdk` `ClientOptions` fields, plus `client`, `serverTools`, `maxServerIterations`, `headers`, `includeUsage`. |
| `runjobs`                    | Zero-configuration browser provider, equivalent to `createRunJobs({ authProvider: "runjobs" })`, constructed lazily on first use.                     |
| `createAuthedFetch(options)` | The authentication and telemetry `fetch` in isolation, for use with another AI SDK provider.                                                          |
| `runjobsMetadataExtractor`   | The cost metadata extractor in isolation.                                                                                                            |

| Provider member                                         | Type                                                |
| ------------------------------------------------------- | --------------------------------------------------- |
| `runjobs(id)` / `.languageModel(id)` / `.chatModel(id)` | `LanguageModelV4`                                   |
| `.embeddingModel(id)`                                   | `EmbeddingModelV4`                                  |
| `.imageModel(id)`                                       | `ImageModelV4`                                      |
| `.client`                                               | The underlying `@runjobsai/sdk` client              |
| `.events`                                               | Telemetry bus, the same object as `.client.events`  |
| `.user` / `.signIn()` / `.signOut()`                    | Browser authentication surface                      |

Model identifiers are those returned by `/v1/models`, such as `"Claude Sonnet 4.6"` or `"Gemini 3 Flash"`. The live catalog can be retrieved with `runjobs.client.models.list()`. The client attaches a token to every request, so under browser authentication this call triggers sign-in like any other, even though the endpoint itself is public.

## Implementation status

`ProviderV4` defines nine members. All four required members are implemented, as are two of the five optional ones:

| Member                 | Required | Status | Notes                                                   |
| ---------------------- | -------- | ------ | ------------------------------------------------------- |
| `specificationVersion` | Yes      | ✅     | `"v4"`                                                  |
| `languageModel`        | Yes      | ✅     | Also exposed as `chatModel` and as a callable shorthand |
| `embeddingModel`       | Yes      | ✅     |                                                         |
| `imageModel`           | Yes      | ✅     |                                                         |
| `speechModel`          | No       | ✅     | `doGenerate` only                                       |
| `transcriptionModel`   | No       | ✅     | `doGenerate` only; streaming transcription is not mapped |
| `rerankingModel`       | No       | ❌     | No corresponding gateway endpoint at present            |
| `skills()`             | No       | ❌     | No corresponding gateway endpoint at present            |
| `files()`              | No       | ❌     | Deliberately not mapped, see below                      |

`files()` will not be implemented. It abstracts a provider file API of the
OpenAI kind: upload a blob, receive an opaque provider-assigned reference, then
cite that reference when calling a model. The runjobs gateway's file service is
object storage: you choose the path, and `list`, `move`, `copy`, `batch` and
`putFromURL` are the operations that matter, none of which `FilesV4` has a
member for. Wrapping one in the other would produce something strictly less
capable than the service itself. Use `provider.client.files`, and pass the
`url` it returns to models that accept one, such as an image model's
`reference_image_urls`.

For everything else without a member, use `provider.client`, which also covers
`video`, `computer` and `models`.

## Development

This package is part of a pnpm workspace. See the
[root README](../../README.md) for the workspace layout, the build and test
design, and the example application.

```bash
pnpm build       # src/ to dist/, ESM and declarations
pnpm typecheck
pnpm test
```

## License

MIT
