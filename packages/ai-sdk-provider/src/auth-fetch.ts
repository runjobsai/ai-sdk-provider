import type { FetchFunction } from "@ai-sdk/provider-utils";
import { newRequestId, type SDKCapability, type SDKEvents } from "@runjobsai/sdk";

/**
 * The bridge between the AI SDK and `@runjobsai/sdk`.
 *
 * `@ai-sdk/openai-compatible` already speaks the gateway's wire format,
 * so we don't reimplement any of the protocol mapping. What it can't do
 * is authenticate the way runjobs does: its `apiKey` / `headers` options
 * are *static*, and the whole point of `@runjobsai/sdk` is that the
 * caller never holds an API key — the token comes from the runjobs.ai
 * browser grant flow, is short-lived, and gets refreshed underneath you.
 *
 * `fetch` is the one option in `OpenAICompatibleProviderSettings` that
 * accepts async work, so it's where the SDK plugs in. This module builds
 * that fetch, and in doing so re-creates the three behaviours the SDK's
 * internal `Transport` provides (it isn't exported, so we can't call it):
 *
 *   1. Resolve a fresh bearer token per request.
 *   2. On 401, invalidate the cached token and retry exactly once —
 *      that's what turns a server-side revocation into a fresh sign-in
 *      instead of a hard failure.
 *   3. Emit `request:*` telemetry on the shared event bus so the
 *      identity badge's activity ring keeps animating for AI SDK
 *      traffic, exactly as it does for `client.chat.*` traffic.
 *
 * It also mirrors `Transport`'s `cache: "no-store"`: identity lives in
 * the Authorization header, never the URL, and the browser HTTP cache
 * doesn't key on headers while being shared across every
 * `*.runjobs.dev` bundle. A cacheable response is one bundle reading
 * another's data.
 */
export interface AuthedFetchOptions {
  /** Resolves the bearer token for the next request. Awaited every
   *  call — never cache the result here, the SDK's BrowserAuth owns
   *  the caching and knows when the token went stale. */
  resolveToken: () => string | Promise<string>;
  /** Invoked on a 401 before the single retry. Wire to
   *  `client.auth.invalidate()`. Throwing cancels the retry and lets
   *  the original 401 surface. */
  onUnauthorized?: () => void | Promise<void>;
  /** Shared bus from `client.events`. Omit to skip telemetry. */
  events?: SDKEvents;
  /** Underlying fetch. Defaults to the platform's. */
  fetchImpl?: FetchFunction;
}

/** Map a gateway path onto the capability bucket the badge renders. */
function capabilityForPath(path: string): SDKCapability {
  if (path.includes("/chat/completions")) return "text";
  if (path.includes("/embeddings")) return "embedding";
  if (path.includes("/images/edits")) return "image_edit";
  if (path.includes("/images/")) return "image_generation";
  if (path.includes("/audio/speech")) return "text_to_speech";
  if (path.includes("/audio/transcriptions")) return "speech_to_text";
  if (path.includes("/video/")) return "video_generation";
  return "text";
}

/**
 * Same ~4-chars-per-token heuristic the SDK uses internally for stream
 * deltas. Duplicated rather than imported because `estimateTokens`
 * lives in the SDK's un-exported `event-wrap` module. The badge shows
 * tokens/sec as a liveness indicator, not for billing, so the 10-30%
 * error on code / CJK text is acceptable — and the exact count from
 * the final chunk's `usage` wins for the end event anyway.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

/** Best-effort peek at the outgoing JSON body for telemetry labels. */
function peekBody(body: BodyInit | null | undefined): {
  model: string;
  streaming: boolean;
} {
  if (typeof body !== "string") return { model: "unknown", streaming: false };
  try {
    const parsed = JSON.parse(body) as { model?: unknown; stream?: unknown };
    return {
      model: typeof parsed.model === "string" ? parsed.model : "unknown",
      streaming: parsed.stream === true,
    };
  } catch {
    return { model: "unknown", streaming: false };
  }
}

/** Usage block as the gateway returns it — OpenAI's plus `total_cost`. */
interface GatewayUsage {
  completion_tokens?: number;
  total_tokens?: number;
  total_cost?: number;
}

/**
 * Build the authenticated `fetch` that `createOpenAICompatible` will
 * use for every request.
 */
export function createAuthedFetch(options: AuthedFetchOptions): FetchFunction {
  const {
    resolveToken,
    onUnauthorized,
    events,
    // Bind to globalThis: an unbound `Window.fetch` invoked with any
    // other receiver throws "Illegal invocation" in browsers.
    fetchImpl = globalThis.fetch.bind(globalThis),
  } = options;

  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { model, streaming } = peekBody(init?.body);
    const capability = capabilityForPath(url);

    const id = newRequestId();
    const startedAt = Date.now();

    const fail = (err: Error & { statusCode?: number }) => {
      events?.emit("request:error", {
        id,
        model,
        capability,
        latencyMs: Date.now() - startedAt,
        error: err,
        ...(typeof err.statusCode === "number" && { statusCode: err.statusCode }),
      });
    };

    // A fresh init per attempt so the retry re-resolves the token.
    // `init.body` is a string here (the AI SDK JSON-stringifies before
    // calling fetch), so replaying it is safe.
    const buildInit = async (): Promise<RequestInit> => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${await resolveToken()}`);
      return { ...init, headers, cache: init?.cache ?? "no-store" };
    };

    events?.emit("request:start", { id, model, capability, startedAt, streaming });

    let response: Response;
    try {
      response = await fetchImpl(url, await buildInit());

      if (response.status === 401 && onUnauthorized) {
        let retry = true;
        try {
          await onUnauthorized();
        } catch {
          // The hook bailed out — surface the original 401 untouched.
          retry = false;
        }
        if (retry) {
          response = await fetchImpl(url, await buildInit());
        }
      }
    } catch (err) {
      // Network-level failure (DNS, offline, abort).
      fail(err as Error);
      throw err;
    }

    if (!response.ok) {
      // Let the AI SDK parse the body into a proper APICallError — we
      // only record that the call failed. The body is untouched.
      fail(
        Object.assign(new Error(`runjobs: HTTP ${response.status}`), {
          statusCode: response.status,
        }),
      );
      return response;
    }

    if (!events) return response;

    return streaming && response.body
      ? instrumentStream(response, { id, model, capability, startedAt, events })
      : instrumentJson(response, { id, model, capability, startedAt, events });
  };
}

interface TelemetryContext {
  id: string;
  model: string;
  capability: SDKCapability;
  startedAt: number;
  events: SDKEvents;
}

/**
 * Non-streaming: clone the response so the AI SDK still gets an
 * unread body, and read the clone just to pull `usage` for the end
 * event. Failing to parse is non-fatal — telemetry must never break
 * the actual call.
 */
function instrumentJson(response: Response, ctx: TelemetryContext): Response {
  const { id, model, capability, startedAt, events } = ctx;
  void response
    .clone()
    .json()
    .then((body: unknown) => {
      const b = body as {
        usage?: GatewayUsage;
        choices?: { finish_reason?: string }[];
      };
      events.emit("request:end", {
        id,
        model,
        capability,
        latencyMs: Date.now() - startedAt,
        totalTokens: b?.usage?.completion_tokens ?? b?.usage?.total_tokens ?? 0,
        ...(b?.usage?.total_cost !== undefined && { costUSD: b.usage.total_cost }),
        ...(b?.choices?.[0]?.finish_reason !== undefined && {
          finishReason: b.choices[0]!.finish_reason,
        }),
      });
    })
    .catch(() => {
      events.emit("request:end", {
        id,
        model,
        capability,
        latencyMs: Date.now() - startedAt,
        totalTokens: 0,
      });
    });
  return response;
}

/**
 * Streaming: pass the SSE bytes through untouched while sniffing each
 * `data:` frame for delta text and the final `usage` roll-up, so the
 * badge gets its per-chunk samples. The transform is byte-identical
 * in, byte-identical out — the AI SDK's own parser sees exactly what
 * the gateway sent.
 */
function instrumentStream(response: Response, ctx: TelemetryContext): Response {
  const { id, model, capability, startedAt, events } = ctx;

  const decoder = new TextDecoder();
  let buffer = "";
  let totalTokens = 0;
  let usageTokens: number | undefined;
  let costUSD: number | undefined;
  let finishReason: string | undefined;
  let settled = false;

  const emitEnd = () => {
    if (settled) return;
    settled = true;
    events.emit("request:end", {
      id,
      model,
      capability,
      latencyMs: Date.now() - startedAt,
      // Prefer the gateway's exact count over our heuristic when the
      // final chunk carried it.
      totalTokens: usageTokens ?? totalTokens,
      ...(costUSD !== undefined && { costUSD }),
      ...(finishReason !== undefined && { finishReason }),
    });
  };

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: {
      usage?: GatewayUsage;
      choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return; // Malformed frame — the real parser will complain.
    }
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) {
      const delta = estimateTokens(text);
      totalTokens += delta;
      events.emit("request:streamDelta", { id, deltaTokens: delta, totalTokens });
    }
    if (chunk.usage?.completion_tokens !== undefined) {
      usageTokens = chunk.usage.completion_tokens;
    }
    if (chunk.usage?.total_cost !== undefined) costUSD = chunk.usage.total_cost;
    const fr = chunk.choices?.[0]?.finish_reason;
    if (fr) finishReason = fr;
  };

  const emitError = (error: Error) => {
    if (settled) return;
    settled = true;
    events.emit("request:error", {
      id,
      model,
      capability,
      latencyMs: Date.now() - startedAt,
      error,
    });
  };

  // A reader-driven ReadableStream rather than a TransformStream: only
  // this shape gives us a `cancel` hook, and without one an aborted
  // stream (user hits stop mid-answer) would leave the call pinned open
  // in the badge forever.
  const reader = response.body!.getReader();
  const spy = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer) consumeLine(buffer.replace(/\r$/, ""));
          emitEnd();
          controller.close();
          return;
        }
        // Forward the bytes untouched — the AI SDK's own SSE parser
        // sees exactly what the gateway sent.
        controller.enqueue(value);

        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          consumeLine(line);
        }
      } catch (err) {
        emitError(err as Error);
        controller.error(err);
      }
    },
    cancel(reason) {
      emitEnd();
      return reader.cancel(reason);
    },
  });

  return new Response(spy, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
