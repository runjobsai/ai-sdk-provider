# Development notes

Decisions that are not obvious from reading the code, and the reasoning behind
them. This file is for people working on the library. It is not user
documentation, which lives in the [README](./README.md) and in
[`packages/ai-sdk-provider/README.md`](./packages/ai-sdk-provider/README.md).

## Build

The build uses [tsdown](https://tsdown.dev), which emits the bundle and the
declarations in a single pass. This avoids both a declaration plugin and a
second `tsc` invocation that would need to be kept in step with the first.

Dependencies are never bundled. `deps.neverBundle` externalizes every bare
specifier, so a package missing from `package.json`, or one placed in
`devDependencies` in error, fails as an undeclared import rather than being
inlined silently. `tests/build.test.ts` asserts both properties against the
built artifact, because the failure mode is otherwise silent: the build reports
success and produces a `dist/` directory that appears correct until the package
is installed.

## Tests

The behaviour suite runs against `src/` rather than `dist/`.
`vitest.config.ts` aliases the package name to the source, so behaviour tests
do not depend on a build. `tests/build.test.ts` is the exception, reading
`dist/`, which is why `pnpm test` builds first.

The browser sign-in flow cannot be tested from Node, as it requires a window to
redirect and a `localStorage` implementation in which to cache a token. The
example application at the repository root exists for that purpose.

> Browser sign-in redirects to `https://www.runjobs.ai/api/sdk/grant` and
> returns to the page origin. If `localhost:5173` is not a registered
> `(origin, app)` pair on the gateway, pin the grant to a project using the
> **Project** field, equivalent to
> `createRunJobs({ authProvider: "runjobs", project: "proj_…" })`.

## Authentication

`@ai-sdk/openai-compatible` accepts a static `apiKey` and static `headers`,
neither of which can carry a token that rotates. `fetch` is the only option it
exposes that accepts async work, so that is where authentication is plugged in.
`auth-fetch.ts` rebuilds the three behaviours the SDK's own `Transport`
provides, which is not exported and therefore cannot be called directly:
per-request token resolution, a single retry after invalidating the token on a
401, and `request:*` telemetry on the shared event bus.

One authed fetch is shared by every model interface. The language and embedding
models receive it through `createOpenAICompatible`; the image, speech and
transcription models use it directly. Sharing it is what keeps token refresh, the 401 retry and the event
bus identical across all of them.

## Image model

This is the one model interface implemented directly rather than delegated to
`@ai-sdk/openai-compatible`, because the two disagree about how a generated
image comes back:

```text
OpenAI    { data: [{ b64_json }] }
gateway   { data: [{ url }] }
```

`url` is the only shape the gateway has. Pointing the stock OpenAI-compatible
image model at it fails on every call with `Invalid JSON response`, because the
mismatch is in the response schema and there is no seam to hook a URL into.

### `maxImagesPerCall`

`generateImage` issues `ceil(n / maxImagesPerCall)` separate requests and
treats `undefined` as `1`, which would turn `n: 4` into four billed calls. The
gateway accepts `n` itself and each model's real ceiling is advertised on
`/v1/models`, so the model never splits locally: one `generateImage` is one
request, and an unsupported `n` surfaces as the gateway's own error.

### Cost has nowhere to go

Unlike the language model, an image call cannot report cost in its result.
`generateImage` merges provider metadata by pushing the `images` array and
discarding every other key, except under the reserved `gateway` provider name:

```js
providerMetadata[providerName] ??= { images: [] };
providerMetadata[providerName].images.push(...metadata.images);
```

`ImageModelV4Usage` carries token counts only, so there is no field there
either. Cost reaches callers on the event bus instead, where the authed fetch
already reports `usage.total_cost` as `costUSD` on `request:end`.

### Naming

The model's `provider` field is `runjobs.image`, following the
`<provider>.<modality>` convention that `@ai-sdk/openai-compatible` uses for the
interfaces it supplies. The `providerMetadata` key stays the bare `runjobs`, so
callers read cost and image metadata under one name regardless of which
interface produced it.

## Generated media comes back as a URL

Both image generation and speech answer with JSON carrying a URL rather than
with the bytes themselves:

```text
POST /v1/images/generations   { data: [{ url }] }
POST /v1/audio/speech         { audio_url }
```

and the URL arrives in one of two transport modes, only one of which costs a
request:

```text
data:<mime>;base64,<payload>     inline, decoded locally
https://…/v1/blobs/<id>          hosted, one extra GET
```

Every AI SDK result type wants bytes, so `media-url.ts` resolves both shapes for
both models. That GET goes through the authed fetch, so it carries the bearer
token, participates in the 401-refresh-retry, and appears on the event bus.
`decodeMediaUrl` from `@runjobsai/sdk` does the same job but always uses the
global `fetch`, which would bypass all three and cannot be intercepted by a
caller-supplied `fetch` in tests.

Speech is the trap here, because OpenAI returns the audio as the raw response
body and it is natural to assume the gateway does too. Reading it that way
succeeds, and produces a blob containing JSON text that no audio element will
play. `tests/provider.test.ts` pins the real shape.

## Structured output

`createOpenAICompatible` is passed `supportsStructuredOutputs: true`. Without
it, `@ai-sdk/openai-compatible` strips the schema out of a `generateObject` or
`streamObject` request and only emits a warning. The model then answers in
prose, and the call fails afterwards with `NoObjectGeneratedError: response did
not match schema`, which points at the model rather than at the configuration.
The gateway does honour `response_format: { type: "json_schema" }`; this was
verified against it, and `tests/provider.test.ts` pins the request shape.

`supportsStructuredOutputs` is exposed on `RunJobsProviderSettings` so it can be
turned off for a model the gateway rejects it for.

## Audio models

`@ai-sdk/openai-compatible` supplies neither a speech nor a transcription
model, so there is nothing to delegate to and both are implemented directly.
Two things about them are worth knowing before editing.

The AI SDK's field names are not the gateway's. `instructions` is sent as
`instruct_text` and `outputFormat` as `response_format`. Tests assert the
gateway spelling on the wire and assert that the AI SDK spelling does not leak
through, because a silent rename is the kind of thing that survives review.

Transcription is the only endpoint the provider talks to that takes a multipart
upload. It must therefore not set its own `content-type`: the runtime writes
that header itself, including the boundary, and overriding it leaves the gateway
unable to parse the body. There is a test for exactly that.

`doStream` is left off the transcription model. It is optional in the spec, and
the gateway's streaming transcription is a separate endpoint with its own
protocol.

## Files, and why the slot stays empty

`FilesV4` abstracts a provider file API of the OpenAI kind: upload a blob,
receive an opaque provider-assigned reference (`providerReference`), then cite
that reference in a later call instead of resending the bytes. Conversation
attachments are a different mechanism, ordinary file parts on a message.

The runjobs gateway's file service is object storage. The caller chooses the
path, and `list`, `move`, `copy`, `batch` and `putFromURL` are the operations
that make it useful. `FilesV4` has a member for none of them, and its
`uploadFile` supplies no path, so an implementation would have to invent one,
discarding the property that makes a bucket a bucket.

Mapping one onto the other therefore produces something strictly less capable
than `provider.client.files`, which callers already have. The integration that
does pay off is smaller: `put()` returns a `url`, and gateway models accept URLs
in fields such as `reference_image_urls` and `reference_audio_url`.

## Gateway capabilities without a `ProviderV4` member

`video`, `computer` and `models` have no member in the spec at all;
`rerankingModel` and `skills()` have no gateway endpoint yet; and `files()` is
deliberately unmapped, as above. All of them are
reached through `provider.client`, the underlying `@runjobsai/sdk` client,
which shares one token, one event bus and one identity badge with the provider.
