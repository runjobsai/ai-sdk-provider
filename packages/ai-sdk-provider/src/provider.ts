import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
  EmbeddingModelV4,
  ImageModelV4,
  LanguageModelV4,
  ProviderV4,
  SpeechModelV4,
  TranscriptionModelV4,
} from "@ai-sdk/provider";
import { RunJobs, type BrowserUser, type ClientOptions, type SDKEvents } from "@runjobsai/sdk";

import { createAuthedFetch } from "./auth-fetch.js";
import { createRunJobsImageModel } from "./image-model.js";
import { runjobsMetadataExtractor } from "./metadata.js";
import { createRunJobsSpeechModel } from "./speech-model.js";
import { createRunJobsTranscriptionModel } from "./transcription-model.js";

/** Provider id. Also the `providerOptions` key — see {@link RunJobsProviderOptions}. */
const PROVIDER_NAME = "runjobs";

/** Gateway origin used when the caller doesn't override `baseURL`.
 *  Mirrors `@runjobsai/sdk`'s own defaulting: the browser grant flow
 *  lives on www, so `authProvider: "runjobs"` has to point there. */
const DEFAULT_ORIGIN = "https://api.runjobs.ai";
const BROWSER_AUTH_ORIGIN = "https://www.runjobs.ai";

/**
 * Platform-executed tools the gateway runs on your behalf. Unlike AI
 * SDK tools (which execute in your process and cost you a round trip
 * each), these run inside the gateway's own loop — the model calls
 * them, the gateway answers them, and you only see the final message.
 */
export type RunJobsServerTool = "web_search" | "web_fetch" | "twitter_search";

/**
 * Per-call knobs, passed as `providerOptions.runjobs`.
 *
 * ```ts
 * await generateText({
 *   model: runjobs("Claude Sonnet 4.6"),
 *   prompt: "What is the latest stable Go version?",
 *   providerOptions: { runjobs: { serverTools: ["web_search", "web_fetch"] } },
 * });
 * ```
 *
 * These ride straight through to the gateway: `@ai-sdk/openai-compatible`
 * spreads any `providerOptions.<providerName>` key it doesn't recognise
 * into the request body verbatim, and the runjobs gateway is the one
 * reading them. camelCase is normalised to the wire's snake_case in
 * {@link transformRequestBody}, so both spellings work.
 */
export interface RunJobsProviderOptions {
  /** Let the gateway run these itself, looping with the model until it
   *  produces a final answer. Mix freely with AI SDK `tools`. */
  serverTools?: RunJobsServerTool[];
  /** Cap on gateway↔model round trips in the server-tool loop.
   *  Default 5, hard cap 10. */
  maxServerIterations?: number;
  /** Per-end-user observability tag. */
  user?: string;
  /** Anything else the gateway accepts — forwarded untouched. */
  [extra: string]: unknown;
}

export interface RunJobsProviderSettings extends ClientOptions {
  /**
   * Reuse an existing `@runjobsai/sdk` client rather than letting the
   * provider construct one. Use this when the app already has a client
   * (and therefore an identity badge and a signed-in user) — building a
   * second one would run a second grant flow and paint a second badge.
   *
   * When set, every other `ClientOptions` field here is ignored except
   * `baseURL`, which still needs to match the client's own.
   */
  client?: RunJobs;

  /** Server tools applied to every call. Per-call
   *  `providerOptions.runjobs.serverTools` overrides this. */
  serverTools?: RunJobsServerTool[];
  /** Default iteration cap for {@link serverTools}. */
  maxServerIterations?: number;

  /** Extra static headers on every request. */
  headers?: Record<string, string>;
  /** Ask for `usage` on the final streaming chunk. Default `true` —
   *  without it there's no cost or token count to report. */
  includeUsage?: boolean;
}

export interface RunJobsProvider extends ProviderV4 {
  /** Shorthand for {@link languageModel}. */
  (modelId: string): LanguageModelV4;

  languageModel(modelId: string): LanguageModelV4;
  chatModel(modelId: string): LanguageModelV4;
  embeddingModel(modelId: string): EmbeddingModelV4;
  imageModel(modelId: string): ImageModelV4;
  speechModel(modelId: string): SpeechModelV4;
  transcriptionModel(modelId: string): TranscriptionModelV4;

  /**
   * The underlying `@runjobsai/sdk` client. This is the escape hatch to
   * everything the AI SDK has no interface for — `client.video.*`,
   * `client.files.*`, `client.computer.*`, `client.models.list()`, the
   * typed options schema, and so on. The AI SDK surfaces and this
   * client share one token, one event bus and one badge.
   */
  readonly client: RunJobs;

  /** Telemetry bus — the same object as `provider.client.events`. */
  readonly events: SDKEvents;

  /** Force the runjobs.ai grant redirect. No-op outside browser auth. */
  signIn(): void;
  /** Clear the cached token and identity. No-op outside browser auth. */
  signOut(): void;
  /** Currently signed-in user, or null. */
  readonly user: BrowserUser | null;
}

/**
 * Normalise the camelCase options TypeScript users expect onto the
 * snake_case the gateway wire format uses, and apply provider-level
 * defaults that a per-call `providerOptions.runjobs` can override.
 *
 * Runs last, on the fully assembled body — by this point
 * `@ai-sdk/openai-compatible` has already spread the caller's
 * `providerOptions.runjobs` into it.
 */
function makeTransformRequestBody(defaults: { serverTools?: RunJobsServerTool[]; maxServerIterations?: number }) {
  return (args: Record<string, unknown>): Record<string, unknown> => {
    const body = { ...args };

    // camelCase → wire format.
    if (body["serverTools"] !== undefined) {
      body["server_tools"] = body["serverTools"];
      delete body["serverTools"];
    }
    if (body["maxServerIterations"] !== undefined) {
      body["max_server_iterations"] = body["maxServerIterations"];
      delete body["maxServerIterations"];
    }

    // Provider-level defaults fill in only where the call said nothing.
    if (body["server_tools"] === undefined && defaults.serverTools?.length) {
      body["server_tools"] = defaults.serverTools;
    }
    if (body["max_server_iterations"] === undefined && defaults.maxServerIterations !== undefined) {
      body["max_server_iterations"] = defaults.maxServerIterations;
    }

    return body;
  };
}

/**
 * Create a RunJobs provider for the AI SDK.
 *
 * The gateway already speaks the OpenAI Chat Completions wire format,
 * so the protocol mapping is `@ai-sdk/openai-compatible`'s — battle
 * tested and maintained upstream. What this package adds is the part
 * that can't be expressed as a static config: authentication through
 * `@runjobsai/sdk`.
 *
 * That's the whole point. Pointing a stock OpenAI-compatible provider
 * at the gateway works, but only if the user has gone and minted an
 * `rk_…` key first. With `authProvider: "runjobs"` there is no key to
 * mint and nothing to keep secret — the SDK runs the runjobs.ai grant
 * handshake, caches and refreshes the token, and the app ships to the
 * browser as-is:
 *
 * ```ts
 * import { createRunJobs } from "@runjobsai/ai-sdk-provider";
 * import { streamText } from "ai";
 *
 * const runjobs = createRunJobs({ authProvider: "runjobs" });
 *
 * const { textStream } = streamText({
 *   model: runjobs("Claude Sonnet 4.6"),
 *   prompt: "Explain async iterators.",
 * });
 * ```
 *
 * Server-side, pass a key instead:
 *
 * ```ts
 * const runjobs = createRunJobs({ apiKey: process.env.RUNJOBS_API_KEY });
 * ```
 */
export function createRunJobs(settings: RunJobsProviderSettings = {}): RunJobsProvider {
  const {
    client: existingClient,
    serverTools,
    maxServerIterations,
    headers,
    includeUsage = true,
    ...clientOptions
  } = settings;

  // Constructing the client is also our options validation — it throws
  // the SDK's own "pass either apiKey, apiKeyResolver, or authProvider"
  // error, so the message a user sees is the one they can search for.
  const client = existingClient ?? new RunJobs(clientOptions);

  // The SDK keeps its resolved base URL private, so re-derive it with
  // the same rule the client uses.
  const origin =
    clientOptions.baseURL ?? (clientOptions.authProvider === "runjobs" ? BROWSER_AUTH_ORIGIN : DEFAULT_ORIGIN);

  // Token resolution. Browser auth owns issuance once it's on — but
  // only where it can actually work.
  //
  // `@runjobsai/sdk` documents `authProvider: "runjobs"` as a no-op in
  // Node, falling back to `apiKey` / `apiKeyResolver`. Its client
  // doesn't implement that: it overwrites `apiKeyResolver` with
  // `auth.getToken` unconditionally, and outside a browser that lands
  // in BrowserAuth's iframe branch and throws "could not obtain a token
  // from the dashboard" — even when a perfectly good key was passed
  // alongside. That combination is rare when you hand-write SDK calls
  // and unavoidable here: one `createRunJobs({ authProvider: "runjobs",
  // apiKey })` module imported by both an SSR render and the browser
  // bundle is the ordinary Next.js shape. So we implement the
  // documented behaviour ourselves.
  //
  // Browser auth still wins whenever it has a window to work with, and
  // when it's the only option configured we defer to it so the user
  // gets BrowserAuth's own error message rather than an empty token.
  const staticResolver =
    clientOptions.apiKeyResolver ?? (clientOptions.apiKey ? () => clientOptions.apiKey! : undefined);
  const useBrowserAuth = client.auth != null && (typeof window !== "undefined" || staticResolver === undefined);
  const resolveToken = useBrowserAuth ? client.auth!.getToken : (staticResolver ?? (() => ""));

  const baseURL = `${origin.replace(/\/+$/, "")}/v1`;

  // One fetch for every model interface: the language and embedding
  // models get it through `createOpenAICompatible`, the image model
  // uses it directly. Sharing it is what keeps token refresh, the
  // 401 retry and the event bus identical across all of them.
  const authedFetch = createAuthedFetch({
    resolveToken,
    // Only meaningful when a rotating token is in play — invalidating
    // a static key would just replay the same 401.
    ...(useBrowserAuth && { onUnauthorized: () => client.auth!.invalidate() }),
    events: client.events,
    ...(clientOptions.fetch && { fetchImpl: clientOptions.fetch }),
  });

  const base = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL,
    includeUsage,
    ...(headers && { headers }),
    // No `apiKey` here on purpose — a static Authorization header can't
    // carry a token that rotates. Auth happens per-request in `fetch`.
    fetch: authedFetch,
    transformRequestBody: makeTransformRequestBody({
      ...(serverTools && { serverTools }),
      ...(maxServerIterations !== undefined && { maxServerIterations }),
    }),
    metadataExtractor: runjobsMetadataExtractor,
  });

  const provider = ((modelId: string) => base.languageModel(modelId)) as RunJobsProvider;

  Object.defineProperties(provider, {
    specificationVersion: { value: "v4" as const, enumerable: true },
    languageModel: { value: (id: string) => base.languageModel(id) },
    chatModel: { value: (id: string) => base.chatModel(id) },
    embeddingModel: { value: (id: string) => base.embeddingModel(id) },
    imageModel: {
      // Not `base.imageModel(id)`: the gateway returns image URLs and
      // `@ai-sdk/openai-compatible` only parses `b64_json`. See
      // `image-model.ts`.
      value: (id: string) =>
        createRunJobsImageModel({
          modelId: id,
          provider: `${PROVIDER_NAME}.image`,
          metadataKey: PROVIDER_NAME,
          baseURL,
          fetch: authedFetch,
          ...(headers && { headers }),
        }),
    },
    speechModel: {
      value: (id: string) =>
        createRunJobsSpeechModel({
          modelId: id,
          provider: `${PROVIDER_NAME}.speech`,
          optionsKey: PROVIDER_NAME,
          baseURL,
          fetch: authedFetch,
          ...(headers && { headers }),
        }),
    },
    transcriptionModel: {
      value: (id: string) =>
        createRunJobsTranscriptionModel({
          modelId: id,
          provider: `${PROVIDER_NAME}.transcription`,
          optionsKey: PROVIDER_NAME,
          baseURL,
          fetch: authedFetch,
          ...(headers && { headers }),
        }),
    },
    client: { value: client, enumerable: true },
    events: { value: client.events, enumerable: true },
    signIn: { value: () => client.signIn() },
    signOut: { value: () => client.signOut() },
    user: { get: () => client.user, enumerable: true },
  });

  return provider;
}

/**
 * Zero-config provider for the common browser case — the runjobs.ai
 * grant flow, no API key anywhere.
 *
 * ```ts
 * import { runjobs } from "@runjobsai/ai-sdk-provider";
 * await generateText({ model: runjobs("Claude Sonnet 4.6"), prompt: "hi" });
 * ```
 *
 * Constructed lazily on first use: `new RunJobs({ authProvider: "runjobs" })`
 * touches `window` and paints the identity badge, which must not happen
 * at import time (it would break SSR and any Node import of this
 * module). Server-side, build your own with
 * {@link createRunJobs} and an `apiKey` instead.
 */
export const runjobs: RunJobsProvider = new Proxy(
  ((modelId: string) => defaultProvider().languageModel(modelId)) as RunJobsProvider,
  {
    get(_target, prop) {
      if (prop === "then") return undefined; // never look thenable
      // No receiver forwarding: every member is a closure over the
      // captured client, so rebinding `this` to the proxy would only
      // add a way to get it wrong.
      return Reflect.get(defaultProvider(), prop);
    },
  },
);

let cached: RunJobsProvider | undefined;
function defaultProvider(): RunJobsProvider {
  cached ??= createRunJobs({ authProvider: "runjobs" });
  return cached;
}
