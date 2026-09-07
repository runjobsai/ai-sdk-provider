# @runjobsai/ai-sdk-provider workspace

**English** · [简体中文](./README.zh-CN.md)

A pnpm workspace containing two parts: the published library, and a React
application of runnable examples that exercises it.

```text
packages/ai-sdk-provider/   library, published to npm as @runjobsai/ai-sdk-provider
index.html, src/            examples, React 19 and Vite, private
```

The library documentation is in
[`packages/ai-sdk-provider/README.md`](./packages/ai-sdk-provider/README.md),
which is the file npm displays.

## Setup

```bash
pnpm install
pnpm dev      # http://localhost:5173
```

## Scripts

Run from the repository root:

```bash
pnpm dev         # examples on http://localhost:5173
pnpm build       # library, then the examples
pnpm typecheck   # both projects
pnpm test        # library suite: build, then vitest
```

Operations scoped to the library alone accept a filter, or can be run from
within `packages/ai-sdk-provider`:

```bash
pnpm --filter @runjobsai/ai-sdk-provider build
```

## Examples

Each example is a single file under `src/labs/`, covering one capability, and
the page displays its own source alongside the running demonstration. They are
ordered by the number of prerequisites each one has: the catalog needs only a
reachable gateway, while the chat example depends on the full stack.

| #   | Example           | Subject                                                    |
| --- | ----------------- | ---------------------------------------------------------- |
| 01  | Model catalog     | `provider.client`, the direct SDK access path               |
| 02  | generateText      | A single non-streaming call, with cost from `providerMetadata` |
| 03  | streamText        | `textStream`, and cancellation via `AbortSignal`            |
| 04  | useChat           | A chat interface with no backend, described below           |
| 05  | Tool loop         | `generateText({ tools })` with each step inspectable        |
| 06  | Server tools      | `web_search` and `web_fetch`, executed by the gateway       |
| 07  | Structured output | `streamObject` populating a zod schema as it streams        |
| 08  | Embeddings        | `embedMany` with `cosineSimilarity`                         |
| 09  | Image generation  | `generateImage`, with gateway knobs via `providerOptions`   |
| 10  | Text to speech    | `generateSpeech`, with voices from the catalog              |
| 11  | Speech to text    | `transcribe`, multipart upload and segment timings          |

A shared connection panel constructs one provider for all examples. Under
`authProvider: "runjobs"` each provider owns a grant handshake and a token
cache, so a second provider would require a second sign-in. Below the examples
is a live view of the `request:*` event bus, the same bus the identity badge
consumes.

### Client-side chat

By default `useChat` posts to an application endpoint such as `/api/chat`,
which is the usual reason a static client-side application is not achievable.
Example 04 supplies a `DirectChatTransport` wrapping a `ToolLoopAgent` instead,
so the entire loop, including tool execution, runs in the browser:

```ts
const agent = new ToolLoopAgent({ model, tools: { weather }, stopWhen: stepCountIs(5) });
const { messages, sendMessage } = useChat({ transport: new DirectChatTransport({ agent }) });
```

No server-side endpoint is required. `useObject` and `useCompletion` cannot be
used this way, as both require an `api` URL and expose no transport
abstraction. Example 07 therefore uses `streamObject` from `ai` core.

## Resolution between the two parts

The examples import the library by its published name,
`@runjobsai/ai-sdk-provider`. That name resolves to
`packages/ai-sdk-provider/src/index.ts`, the source rather than `dist/`, through
the `paths` entry in the root `tsconfig.json`, which Vite reads natively via
`resolve.tsconfigPaths`. Editing the library therefore hot-reloads the page, no
build step is required between the two, and the mapping is declared in one
place.

The workspace link in `package.json`
(`"@runjobsai/ai-sdk-provider": "workspace:*"`) establishes the dependency for
pnpm and keeps the import accurate. Without the `paths` entry it would resolve
to the built `dist/`, which is what consumers of the published package receive.

## Implementation notes

Decisions that are not obvious from the code — the build, the test split,
authentication, and the image model — are written up in
[DEVELOPMENT.md](./DEVELOPMENT.md).

## Capability coverage

Six of the nine `ProviderV4` members are implemented: all four required ones,
plus `speechModel` and `transcriptionModel`. `rerankingModel` and `skills()`
have no gateway endpoint yet, and `files()` is deliberately not mapped because
the gateway's file service is object storage rather than a provider file API.
The complete table is in the
[library README](./packages/ai-sdk-provider/README.md#implementation-status).

## Publishing

```bash
pnpm --filter @runjobsai/ai-sdk-provider publish
```

`prepublishOnly` cleans, typechecks and rebuilds beforehand, and `files`
restricts the tarball to `dist/` and the README files.
