import { createAuthedFetch, createRunJobs } from "@runjobsai/ai-sdk-provider";
import {
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  generateImage,
  generateObject,
  generateText,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { expect, test } from "vitest";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface RecordedCall {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: any;
  /** Set instead of `body` when the request was a multipart upload. */
  form: FormData | undefined;
  cache: string | undefined;
}

/** Records every call, replies with whatever the handler hands back. */
function stubFetch(handler: (index: number, calls: RecordedCall[]) => Response) {
  const calls: RecordedCall[] = [];
  const fn = async (url: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      form: init?.body instanceof FormData ? init.body : undefined,
      cache: init?.cache,
    });
    return handler(calls.length - 1, calls);
  };
  return Object.assign(fn as unknown as typeof fetch, { calls });
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sseResponse = (frames: unknown[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const completion = (content: string, usage?: Record<string, unknown>) => ({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "Claude Sonnet 4.6",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13, ...usage },
});

/* ------------------------------------------------------------------ */
/* Request shaping                                                     */
/* ------------------------------------------------------------------ */

test("sends an OpenAI-compatible request to the gateway with a bearer token", async () => {
  const fetch = stubFetch(() => jsonResponse(completion("hi there", { total_cost: 0.000123 })));
  const runjobs = createRunJobs({ apiKey: "rk_test", fetch });

  const result = await generateText({
    model: runjobs("Claude Sonnet 4.6"),
    prompt: "say hi",
  });

  expect(result.text).toBe("hi there");

  const [call] = fetch.calls;
  expect(call.url).toBe("https://api.runjobs.ai/v1/chat/completions");
  expect(call.method).toBe("POST");
  expect(call.headers.get("authorization")).toBe("Bearer rk_test");
  // Transport parity: identity is in the header, so the response must
  // never be cacheable by the shared browser HTTP cache.
  expect(call.cache).toBe("no-store");
  expect(call.body.model).toBe("Claude Sonnet 4.6");
  expect(call.body.messages).toEqual([{ role: "user", content: "say hi" }]);
});

test("browser auth picks the www origin but falls back to the key off-browser", async () => {
  const fetch = stubFetch(() => jsonResponse(completion("ok")));
  // The isomorphic shape: one module for the SSR render and the browser
  // bundle. `@runjobsai/sdk`'s own client would throw here — it hands
  // every request to BrowserAuth even with no window and a key sitting
  // right there — so this guards our fallback.
  const runjobs = createRunJobs({ authProvider: "runjobs", apiKey: "rk_test", fetch });

  await generateText({ model: runjobs("Gemini 3 Flash"), prompt: "x" });

  // The origin still follows the auth mode: /api/sdk/grant only lives on www.
  expect(fetch.calls[0].url).toBe("https://www.runjobs.ai/v1/chat/completions");
  expect(fetch.calls[0].headers.get("authorization")).toBe("Bearer rk_test");
});

test("exposes gateway cost as provider metadata", async () => {
  const fetch = stubFetch(() =>
    jsonResponse(
      completion("answer", {
        total_cost: 0.0123,
        tool_costs: [{ name: "web_search", count: 2, cost: 0.01 }],
      }),
    ),
  );
  const runjobs = createRunJobs({ apiKey: "rk_test", fetch });

  const { providerMetadata } = await generateText({
    model: runjobs("Claude Sonnet 4.6"),
    prompt: "x",
  });

  expect(providerMetadata?.runjobs.totalCost).toBe(0.0123);
  expect(providerMetadata?.runjobs.toolCosts).toEqual([{ name: "web_search", count: 2, cost: 0.01 }]);
});

/* ------------------------------------------------------------------ */
/* Server tools                                                        */
/* ------------------------------------------------------------------ */

test("per-call providerOptions reach the wire as snake_case", async () => {
  const fetch = stubFetch(() => jsonResponse(completion("go1.26")));
  const runjobs = createRunJobs({ apiKey: "rk_test", fetch });

  await generateText({
    model: runjobs("Claude Sonnet 4.6"),
    prompt: "latest go version?",
    providerOptions: {
      runjobs: { serverTools: ["web_search", "web_fetch"], maxServerIterations: 3 },
    },
  });

  const { body } = fetch.calls[0];
  expect(body.server_tools).toEqual(["web_search", "web_fetch"]);
  expect(body.max_server_iterations).toBe(3);
  // The camelCase spellings must not also ride along.
  expect(body.serverTools).toBeUndefined();
  expect(body.maxServerIterations).toBeUndefined();
});

test("provider-level server tools apply by default and yield to per-call ones", async () => {
  const fetch = stubFetch(() => jsonResponse(completion("ok")));
  const runjobs = createRunJobs({
    apiKey: "rk_test",
    fetch,
    serverTools: ["web_search"],
    maxServerIterations: 5,
  });

  await generateText({ model: runjobs("Claude Sonnet 4.6"), prompt: "a" });
  expect(fetch.calls[0].body.server_tools).toEqual(["web_search"]);
  expect(fetch.calls[0].body.max_server_iterations).toBe(5);

  await generateText({
    model: runjobs("Claude Sonnet 4.6"),
    prompt: "b",
    providerOptions: { runjobs: { serverTools: ["twitter_search"] } },
  });
  expect(fetch.calls[1].body.server_tools).toEqual(["twitter_search"]);
  // The default iteration cap still fills in where the call was silent.
  expect(fetch.calls[1].body.max_server_iterations).toBe(5);
});

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

test("streams text and reports cost from the final chunk", async () => {
  const frames = [
    { id: "1", choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }] },
    { id: "1", choices: [{ index: 0, delta: { content: "lo" } }] },
    { id: "1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    {
      id: "1",
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, total_cost: 0.0004 },
    },
  ];
  const fetch = stubFetch(() => sseResponse(frames));
  const runjobs = createRunJobs({ apiKey: "rk_test", fetch });

  const result = streamText({ model: runjobs("Gemini 3 Flash"), prompt: "hi" });

  let text = "";
  for await (const chunk of result.textStream) text += chunk;

  expect(text).toBe("Hello");
  expect(fetch.calls[0].body.stream).toBe(true);
  // includeUsage defaults on — without it there is no cost to report.
  expect(fetch.calls[0].body.stream_options).toEqual({ include_usage: true });
  expect((await result.providerMetadata)?.runjobs.totalCost).toBe(0.0004);
});

/* ------------------------------------------------------------------ */
/* Telemetry                                                           */
/* ------------------------------------------------------------------ */

test("emits SDK events so the identity badge tracks AI SDK traffic", async () => {
  const fetch = stubFetch(() => jsonResponse(completion("hi", { total_cost: 0.5 })));
  const runjobs = createRunJobs({ apiKey: "rk_test", fetch });

  const starts: any[] = [];
  const ends: any[] = [];
  runjobs.events.on("request:start", (e) => starts.push(e));
  runjobs.events.on("request:end", (e) => ends.push(e));

  await generateText({ model: runjobs("Claude Sonnet 4.6"), prompt: "x" });
  // The end event is emitted off a cloned-response read, so let the
  // microtask queue drain.
  await new Promise((r) => setTimeout(r, 10));

  expect(starts).toHaveLength(1);
  expect(starts[0].model).toBe("Claude Sonnet 4.6");
  expect(starts[0].capability).toBe("text");
  expect(starts[0].streaming).toBe(false);

  expect(ends).toHaveLength(1);
  expect(ends[0].id, "start and end must share a request id").toBe(starts[0].id);
  expect(ends[0].costUSD).toBe(0.5);
  expect(ends[0].finishReason).toBe("stop");
});

test("emits stream deltas without disturbing the forwarded bytes", async () => {
  const frames = [
    { id: "1", choices: [{ index: 0, delta: { content: "aaaa" } }] },
    { id: "1", choices: [{ index: 0, delta: { content: "bbbb" } }] },
    { id: "1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { id: "1", choices: [], usage: { completion_tokens: 7, total_cost: 0.02 } },
  ];
  const fetch = stubFetch(() => sseResponse(frames));
  const runjobs = createRunJobs({ apiKey: "rk_test", fetch });

  const deltas: any[] = [];
  let end: any;
  runjobs.events.on("request:streamDelta", (e) => deltas.push(e));
  runjobs.events.on("request:end", (e) => (end = e));

  const result = streamText({ model: runjobs("Gemini 3 Flash"), prompt: "hi" });
  let text = "";
  for await (const chunk of result.textStream) text += chunk;

  expect(text, "instrumentation must not alter the payload").toBe("aaaabbbb");
  expect(deltas).toHaveLength(2);
  expect(deltas[0].deltaTokens).toBeGreaterThan(0);
  expect(deltas[1].totalTokens).toBe(deltas[0].deltaTokens + deltas[1].deltaTokens);
  expect(end).toBeDefined();
  // Exact upstream count wins over the char-based estimate.
  expect(end.totalTokens).toBe(7);
  expect(end.costUSD).toBe(0.02);
});

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

test("refreshes the token on 401 and retries exactly once", async () => {
  const tokens = ["stale", "fresh"];
  let issued = 0;
  let invalidated = 0;

  const fetch = stubFetch((i) =>
    i === 0 ? jsonResponse({ error: "unauthorized" }, 401) : jsonResponse(completion("ok")),
  );

  const authed = createAuthedFetch({
    resolveToken: () => tokens[issued++]!,
    onUnauthorized: () => {
      invalidated++;
    },
    fetchImpl: fetch,
  });

  const resp = await authed("https://api.runjobs.ai/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "m", messages: [] }),
  });

  expect(resp.status).toBe(200);
  expect(invalidated).toBe(1);
  expect(fetch.calls, "exactly one retry").toHaveLength(2);
  expect(fetch.calls[0].headers.get("authorization")).toBe("Bearer stale");
  expect(fetch.calls[1].headers.get("authorization")).toBe("Bearer fresh");
});

test("does not retry a 401 when no invalidation hook is wired", async () => {
  const fetch = stubFetch(() => jsonResponse({ error: "unauthorized" }, 401));
  const authed = createAuthedFetch({ resolveToken: () => "k", fetchImpl: fetch });

  const resp = await authed("https://api.runjobs.ai/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "m", messages: [] }),
  });

  expect(resp.status).toBe(401);
  expect(fetch.calls).toHaveLength(1);
});

test("a throwing invalidation hook surfaces the original 401", async () => {
  const fetch = stubFetch(() => jsonResponse({ error: "unauthorized" }, 401));
  const authed = createAuthedFetch({
    resolveToken: () => "k",
    onUnauthorized: () => {
      throw new Error("sign-in cancelled");
    },
    fetchImpl: fetch,
  });

  const resp = await authed("https://api.runjobs.ai/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "m", messages: [] }),
  });

  expect(resp.status).toBe(401);
  expect(fetch.calls, "a bailing hook must cancel the retry").toHaveLength(1);
});

test("resolves a fresh token per request", async () => {
  let n = 0;
  const fetch = stubFetch(() => jsonResponse(completion("ok")));
  const runjobs = createRunJobs({ apiKeyResolver: () => `rk_${n++}`, fetch });

  await generateText({ model: runjobs("Claude Sonnet 4.6"), prompt: "a" });
  await generateText({ model: runjobs("Claude Sonnet 4.6"), prompt: "b" });

  expect(fetch.calls[0].headers.get("authorization")).toBe("Bearer rk_0");
  expect(fetch.calls[1].headers.get("authorization")).toBe("Bearer rk_1");
});

/* ------------------------------------------------------------------ */
/* Provider surface                                                    */
/* ------------------------------------------------------------------ */

test("exposes the underlying SDK client as the escape hatch", () => {
  const runjobs = createRunJobs({ apiKey: "rk_test" });

  expect(runjobs.specificationVersion).toBe("v4");
  // Everything the AI SDK has no interface for stays reachable.
  for (const service of ["chat", "models", "image", "audio", "video", "computer", "files"]) {
    expect(runjobs.client[service as keyof typeof runjobs.client]).toBeTruthy();
  }
  expect(runjobs.events, "one bus, one badge").toBe(runjobs.client.events);
  expect(runjobs.user).toBeNull();
  expect(typeof runjobs.signIn).toBe("function");
  expect(typeof runjobs.signOut).toBe("function");
});

test("reuses a caller-supplied client instead of starting a second grant flow", async () => {
  const { RunJobs } = await import("@runjobsai/sdk");
  const client = new RunJobs({ apiKey: "rk_shared" });
  const runjobs = createRunJobs({ client });

  expect(runjobs.client).toBe(client);
});

test("builds language, embedding and image models", () => {
  const runjobs = createRunJobs({ apiKey: "rk_test" });

  expect(runjobs.languageModel("Claude Sonnet 4.6").specificationVersion).toBe("v4");
  expect(runjobs.chatModel("Claude Sonnet 4.6").provider).toBe("runjobs.chat");
  expect(runjobs.embeddingModel("text-embedding-3-small").provider).toBe("runjobs.embedding");
  expect(runjobs.imageModel("MiniMax Image-01").provider).toBe("runjobs.image");
});

test("rejects a config with no way to authenticate", () => {
  expect(() => createRunJobs({})).toThrow(/apiKey/);
});

/* ------------------------------------------------------------------ */
/* Agent loop — the whole point of the package                         */
/* ------------------------------------------------------------------ */

test("runs a multi-step tool-calling loop", async () => {
  const toolCall = {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "Claude Sonnet 4.6",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "weather", arguments: '{"city":"Shanghai"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, total_cost: 0.001 },
  };

  const fetch = stubFetch((i) =>
    i === 0 ? jsonResponse(toolCall) : jsonResponse(completion("It is 22°C in Shanghai.")),
  );
  const runjobs = createRunJobs({ apiKey: "rk_test", fetch });

  let executed = 0;
  const result = await generateText({
    model: runjobs("Claude Sonnet 4.6"),
    prompt: "weather in Shanghai?",
    tools: {
      weather: tool({
        description: "Get the weather for a city",
        inputSchema: z.object({ city: z.string() }),
        execute: async ({ city }) => {
          executed++;
          return { city, celsius: 22 };
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  expect(executed, "the tool must actually run").toBe(1);
  expect(fetch.calls, "one call to ask, one to answer").toHaveLength(2);
  expect(result.text).toBe("It is 22°C in Shanghai.");
  expect(result.steps).toHaveLength(2);

  // Step 1 advertised the tool in OpenAI function-tool shape...
  const [first, second] = fetch.calls;
  expect(first.body.tools[0].type).toBe("function");
  expect(first.body.tools[0].function.name).toBe("weather");

  // ...and step 2 fed the result back as a tool message.
  const toolMessage = second.body.messages.find((m: any) => m.role === "tool");
  expect(toolMessage, "the tool result must be sent back to the model").toBeDefined();
  expect(toolMessage.tool_call_id).toBe("call_1");
});

/* ------------------------------------------------------------------ */
/* Image generation                                                    */
/* ------------------------------------------------------------------ */

/**
 * The gateway returns `data[].url`, never `b64_json`, so this model is
 * implemented here rather than delegated to `@ai-sdk/openai-compatible`
 * — which parses only `b64_json` and throws `Invalid JSON response` on
 * everything the gateway actually sends. These tests pin that contract.
 */

/** A 1x1 PNG, as the gateway's inline transport mode encodes it. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const imageResponse = (data: unknown[], usage?: Record<string, unknown>) => ({
  created: 1_700_000_000,
  data,
  ...(usage && { usage }),
});

test("generates an image from an inline data: url without a second request", async () => {
  const fetch = stubFetch(() =>
    jsonResponse(imageResponse([{ url: `data:image/png;base64,${PNG_B64}` }])),
  );
  const runjobs = createRunJobs({ apiKey: "rk_img", fetch });

  const result = await generateImage({
    model: runjobs.imageModel("Seedream 4.0"),
    prompt: "a cat",
  });

  expect(fetch.calls, "an inline payload needs no download").toHaveLength(1);
  const [call] = fetch.calls;
  expect(call.url).toBe("https://api.runjobs.ai/v1/images/generations");
  expect(call.method).toBe("POST");
  expect(call.headers.get("authorization")).toBe("Bearer rk_img");
  expect(call.body.model).toBe("Seedream 4.0");
  expect(call.body.prompt).toBe("a cat");

  expect(result.image.base64).toBe(PNG_B64);
});

test("downloads a hosted blob url through the same authed fetch", async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  const fetch = stubFetch((index) =>
    index === 0
      ? jsonResponse(imageResponse([{ url: "https://api.runjobs.ai/v1/blobs/abc" }]))
      : new Response(bytes, { status: 200, headers: { "content-type": "image/png" } }),
  );
  const runjobs = createRunJobs({ apiKey: "rk_img", fetch });

  const result = await generateImage({
    model: runjobs.imageModel("Seedream 4.0"),
    prompt: "a cat",
  });

  expect(fetch.calls, "generate, then download").toHaveLength(2);
  const [, download] = fetch.calls;
  expect(download.url).toBe("https://api.runjobs.ai/v1/blobs/abc");
  // The whole point of not using the SDK's `decodeMediaUrl`: that one
  // uses the global fetch and would send no token.
  expect(download.headers.get("authorization")).toBe("Bearer rk_img");
  expect(result.image.uint8Array).toEqual(bytes);
});

test("sends one request for n images rather than splitting the call", async () => {
  const fetch = stubFetch((index) =>
    index === 0
      ? jsonResponse(
          imageResponse([
            { url: "https://api.runjobs.ai/v1/blobs/a" },
            { url: "https://api.runjobs.ai/v1/blobs/b" },
          ]),
        )
      : new Response(Uint8Array.from([1]), { status: 200 }),
  );
  const runjobs = createRunJobs({ apiKey: "rk_img", fetch });

  const result = await generateImage({
    model: runjobs.imageModel("Seedream 4.0"),
    prompt: "two cats",
    n: 2,
  });

  expect(result.images).toHaveLength(2);
  // `generateImage` issues `ceil(n / maxImagesPerCall)` requests and
  // reads `undefined` as 1, which would bill this twice. The gateway
  // takes `n` itself, so it must stay a single generation call.
  expect(fetch.calls[0].body.n).toBe(2);
  expect(fetch.calls, "one generation, then one download per image").toHaveLength(3);
});

test("forwards gateway-specific knobs through providerOptions", async () => {
  const fetch = stubFetch(() =>
    jsonResponse(imageResponse([{ url: `data:image/png;base64,${PNG_B64}` }])),
  );
  const runjobs = createRunJobs({ apiKey: "rk_img", fetch });

  await generateImage({
    model: runjobs.imageModel("Seedream 4.0"),
    prompt: "a cat",
    size: "1024x1024",
    aspectRatio: "16:9",
    providerOptions: {
      runjobs: { resolution: "2k", style: "anime", reference_image_urls: ["https://x/y.png"] },
    },
  });

  const [call] = fetch.calls;
  expect(call.body.size).toBe("1024x1024");
  expect(call.body.aspect_ratio).toBe("16:9");
  // These have no AI SDK field at all — providerOptions is the only way
  // to reach them, and they must survive verbatim.
  expect(call.body.resolution).toBe("2k");
  expect(call.body.style).toBe("anime");
  expect(call.body.reference_image_urls).toEqual(["https://x/y.png"]);
});

test("reports per-image metadata and cost the AI SDK has no field for", async () => {
  const fetch = stubFetch(() =>
    jsonResponse(
      imageResponse(
        [
          {
            url: `data:image/png;base64,${PNG_B64}`,
            revised_prompt: "a photorealistic cat",
            size: "1024x1024",
            attribution: "Photo by Jane Doe on Pexels",
          },
        ],
        { total_cost: 0.004 },
      ),
    ),
  );
  const runjobs = createRunJobs({ apiKey: "rk_img", fetch });

  const result = await generateImage({
    model: runjobs.imageModel("Seedream 4.0"),
    prompt: "a cat",
  });

  const meta = result.providerMetadata["runjobs"] as any;
  expect(meta.images[0].revisedPrompt).toBe("a photorealistic cat");
  expect(meta.images[0].attribution).toBe("Photo by Jane Doe on Pexels");
  // The original URL is kept so a caller that only wants to display the
  // image can skip re-encoding the bytes.
  expect(meta.images[0].url).toMatch(/^data:image\/png;base64,/);
});

test("reports image cost on the event bus, the only channel that survives", async () => {
  const fetch = stubFetch(() =>
    jsonResponse(
      imageResponse([{ url: `data:image/png;base64,${PNG_B64}` }], { total_cost: 0.004 }),
    ),
  );
  const runjobs = createRunJobs({ apiKey: "rk_img", fetch });

  const costs: (number | undefined)[] = [];
  runjobs.events.on("request:end", (e) => costs.push(e.costUSD));

  const result = await generateImage({
    model: runjobs.imageModel("Seedream 4.0"),
    prompt: "a cat",
  });

  // `generateImage` merges provider metadata by pushing `images` and
  // discarding every other key, so unlike the language model there is
  // nowhere in the result to put cost. It has to come off the bus.
  expect((result.providerMetadata["runjobs"] as any).totalCost).toBeUndefined();
  expect(costs).toContain(0.004);
});

test("warns instead of silently dropping settings the gateway has no field for", async () => {
  const fetch = stubFetch(() =>
    jsonResponse(imageResponse([{ url: `data:image/png;base64,${PNG_B64}` }])),
  );
  const runjobs = createRunJobs({ apiKey: "rk_img", fetch });

  const result = await generateImage({
    model: runjobs.imageModel("Seedream 4.0"),
    prompt: "a cat",
    seed: 42,
  });

  expect(result.warnings.some((w) => w.type === "unsupported" && w.feature === "seed")).toBe(true);
  expect(fetch.calls[0].body.seed, "an unsupported field must not reach the wire").toBeUndefined();
});

test("emits image_generation telemetry, not the text default", async () => {
  const fetch = stubFetch(() =>
    jsonResponse(imageResponse([{ url: `data:image/png;base64,${PNG_B64}` }])),
  );
  const runjobs = createRunJobs({ apiKey: "rk_img", fetch });

  const capabilities: string[] = [];
  runjobs.events.on("request:start", (e) => capabilities.push(e.capability));

  await generateImage({ model: runjobs.imageModel("Seedream 4.0"), prompt: "a cat" });

  expect(capabilities).toContain("image_generation");
});

/* ------------------------------------------------------------------ */
/* Speech                                                              */
/* ------------------------------------------------------------------ */

const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x00]);
const MP3_B64 = "//uQAA==";

/**
 * The gateway answers speech with JSON carrying a URL, not with the
 * audio as the raw body. Reading the body as bytes yields the JSON
 * text, which is a blob nothing can play, so these fixtures pin the
 * real wire shape.
 */
const speechResponse = (audioUrl: string, usage?: Record<string, unknown>) =>
  jsonResponse({ audio_url: audioUrl, ...(usage && { usage }) });

const inlineAudio = () => speechResponse(`data:audio/mpeg;base64,${MP3_B64}`);

test("generates speech and returns the bytes unconverted", async () => {
  const fetch = stubFetch(() => inlineAudio());
  const runjobs = createRunJobs({ apiKey: "rk_tts", fetch });

  const result = await generateSpeech({
    model: runjobs.speechModel("CosyVoice"),
    text: "hello there",
    voice: "nova",
    speed: 1.2,
  });

  const [call] = fetch.calls;
  expect(call.url).toBe("https://api.runjobs.ai/v1/audio/speech");
  expect(call.headers.get("authorization")).toBe("Bearer rk_tts");
  // The AI SDK's field names are not the gateway's.
  expect(call.body.input, "`text` is the gateway's `input`").toBe("hello there");
  expect(call.body.voice).toBe("nova");
  expect(call.body.speed).toBe(1.2);
  expect(result.audio.uint8Array, "the inline payload must be decoded").toEqual(MP3);
});

test("downloads a hosted audio url through the same authed fetch", async () => {
  const fetch = stubFetch((index) =>
    index === 0
      ? speechResponse("https://api.runjobs.ai/v1/blobs/spoken")
      : new Response(MP3 as unknown as BodyInit, { status: 200, headers: { "content-type": "audio/mpeg" } }),
  );
  const runjobs = createRunJobs({ apiKey: "rk_tts", fetch });

  const result = await generateSpeech({ model: runjobs.speechModel("CosyVoice"), text: "hello" });

  expect(fetch.calls, "generate, then download").toHaveLength(2);
  expect(fetch.calls[1].url).toBe("https://api.runjobs.ai/v1/blobs/spoken");
  expect(fetch.calls[1].headers.get("authorization")).toBe("Bearer rk_tts");
  expect(result.audio.uint8Array).toEqual(MP3);
});

test("fails loudly when the gateway returns no audio_url", async () => {
  const fetch = stubFetch(() => jsonResponse({ usage: { total_cost: 0 } }));
  const runjobs = createRunJobs({ apiKey: "rk_tts", fetch });

  await expect(
    generateSpeech({ model: runjobs.speechModel("CosyVoice"), text: "hello" }),
  ).rejects.toThrow(/no audio_url/);
});

test("maps instructions onto the gateway's instruct_text", async () => {
  const fetch = stubFetch(() => inlineAudio());
  const runjobs = createRunJobs({ apiKey: "rk_tts", fetch });

  await generateSpeech({
    model: runjobs.speechModel("CosyVoice"),
    text: "hello",
    instructions: "read this cheerfully",
    outputFormat: "wav",
  });

  const [call] = fetch.calls;
  expect(call.body.instruct_text).toBe("read this cheerfully");
  expect(call.body.response_format, "`outputFormat` is the gateway's `response_format`").toBe("wav");
  expect(call.body.instructions, "the AI SDK spelling must not leak through").toBeUndefined();
});

test("forwards gateway-only voice controls through providerOptions", async () => {
  const fetch = stubFetch(() => inlineAudio());
  const runjobs = createRunJobs({ apiKey: "rk_tts", fetch });

  await generateSpeech({
    model: runjobs.speechModel("CosyVoice"),
    text: "hello",
    providerOptions: { runjobs: { emotion: "happy", pitch: 3, volume: 1.5, timber: -2 } },
  });

  const [call] = fetch.calls;
  expect(call.body).toMatchObject({ emotion: "happy", pitch: 3, volume: 1.5, timber: -2 });
});

test("warns that speech language is chosen by the voice", async () => {
  const fetch = stubFetch(() => inlineAudio());
  const runjobs = createRunJobs({ apiKey: "rk_tts", fetch });

  const result = await generateSpeech({
    model: runjobs.speechModel("CosyVoice"),
    text: "hello",
    language: "en",
  });

  expect(result.warnings.some((w) => w.type === "unsupported" && w.feature === "language")).toBe(true);
  expect(fetch.calls[0].body.language).toBeUndefined();
});

test("emits text_to_speech telemetry", async () => {
  const fetch = stubFetch(() => inlineAudio());
  const runjobs = createRunJobs({ apiKey: "rk_tts", fetch });

  const capabilities: string[] = [];
  runjobs.events.on("request:start", (e) => capabilities.push(e.capability));

  await generateSpeech({ model: runjobs.speechModel("CosyVoice"), text: "hello" });

  expect(capabilities).toContain("text_to_speech");
});

/* ------------------------------------------------------------------ */
/* Transcription                                                       */
/* ------------------------------------------------------------------ */

const WAV = Uint8Array.from([0x52, 0x49, 0x46, 0x46]);

const verboseJson = {
  text: "hello there",
  language: "en",
  duration: 1.5,
  segments: [
    { text: "hello", start: 0, end: 0.7 },
    { text: " there", start: 0.7, end: 1.5 },
  ],
};

test("uploads audio as multipart and parses a verbose transcript", async () => {
  const fetch = stubFetch(() => jsonResponse(verboseJson));
  const runjobs = createRunJobs({ apiKey: "rk_stt", fetch });

  const result = await transcribe({
    model: runjobs.transcriptionModel("Whisper"),
    audio: WAV,
  });

  const [call] = fetch.calls;
  expect(call.url).toBe("https://api.runjobs.ai/v1/audio/transcriptions");
  expect(call.headers.get("authorization")).toBe("Bearer rk_stt");
  // Setting content-type ourselves would drop the multipart boundary
  // the runtime generates, and the gateway could not parse the body.
  expect(call.headers.get("content-type"), "the runtime must own this header").toBeNull();

  expect(result.text).toBe("hello there");
  expect(result.language).toBe("en");
  expect(result.durationInSeconds).toBe(1.5);
  expect(result.segments).toEqual([
    { text: "hello", startSecond: 0, endSecond: 0.7 },
    { text: " there", startSecond: 0.7, endSecond: 1.5 },
  ]);
});

test("sends the model and the file as multipart fields", async () => {
  const fetch = stubFetch(() => jsonResponse(verboseJson));
  const runjobs = createRunJobs({ apiKey: "rk_stt", fetch });

  await transcribe({
    model: runjobs.transcriptionModel("Whisper"),
    audio: WAV,
  });

  const form = fetch.calls[0].form!;
  expect(form.get("model")).toBe("Whisper");
  const file = form.get("file") as File;
  expect(file, "the audio must ride as a file part").toBeInstanceOf(Blob);
  expect(file.type).toBe("audio/wav");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(WAV);
});

test("accepts base64 audio as well as bytes", async () => {
  const fetch = stubFetch(() => jsonResponse(verboseJson));
  const runjobs = createRunJobs({ apiKey: "rk_stt", fetch });

  await transcribe({
    model: runjobs.transcriptionModel("Whisper"),
    // The spec allows either; the AI SDK hands over base64 for a string.
    audio: "UklGRg==",
  });

  const file = fetch.calls[0].form!.get("file") as File;
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(WAV); // "UklGRg==" is "RIFF"
});

test("forwards transcription options, repeating array fields per entry", async () => {
  const fetch = stubFetch(() => jsonResponse(verboseJson));
  const runjobs = createRunJobs({ apiKey: "rk_stt", fetch });

  await transcribe({
    model: runjobs.transcriptionModel("Whisper"),
    audio: WAV,
    providerOptions: {
      runjobs: {
        language: "en",
        response_format: "verbose_json",
        timestamp_granularities: ["segment", "word"],
      },
    },
  });

  const form = fetch.calls[0].form!;
  expect(form.get("language")).toBe("en");
  expect(form.get("response_format")).toBe("verbose_json");
  expect(form.getAll("timestamp_granularities")).toEqual(["segment", "word"]);
});

test("returns an empty segment list when the transcript is not verbose", async () => {
  const fetch = stubFetch(() => jsonResponse({ text: "hello there" }));
  const runjobs = createRunJobs({ apiKey: "rk_stt", fetch });

  const result = await transcribe({
    model: runjobs.transcriptionModel("Whisper"),
    audio: WAV,
  });

  expect(result.text).toBe("hello there");
  expect(result.segments).toEqual([]);
  expect(result.language).toBeUndefined();
});

test("emits speech_to_text telemetry", async () => {
  const fetch = stubFetch(() => jsonResponse(verboseJson));
  const runjobs = createRunJobs({ apiKey: "rk_stt", fetch });

  const capabilities: string[] = [];
  runjobs.events.on("request:start", (e) => capabilities.push(e.capability));

  await transcribe({ model: runjobs.transcriptionModel("Whisper"), audio: WAV });

  expect(capabilities).toContain("speech_to_text");
});

/* ------------------------------------------------------------------ */
/* Structured output                                                   */
/* ------------------------------------------------------------------ */

/**
 * `@ai-sdk/openai-compatible` drops a `generateObject` schema from the
 * request unless the provider declares `supportsStructuredOutputs`, and
 * only warns about it. The model then answers in prose and the call
 * fails afterwards with `NoObjectGeneratedError`, which reads like a
 * model problem rather than a configuration one. These pin the default.
 */

const cityCompletion = () => completion('{"city":"Shanghai"}');

test("sends generateObject schemas to the gateway as json_schema", async () => {
  const fetch = stubFetch(() => jsonResponse(cityCompletion()));
  const runjobs = createRunJobs({ apiKey: "rk_obj", fetch });

  const result = await generateObject({
    model: runjobs("Claude Sonnet 4.6"),
    schema: z.object({ city: z.string() }),
    prompt: "Name a city.",
  });

  const [call] = fetch.calls;
  expect(call.body.response_format?.type, "the schema must reach the wire").toBe("json_schema");
  expect(call.body.response_format.json_schema.schema.properties.city).toBeDefined();
  expect(result.object).toEqual({ city: "Shanghai" });
});

test("structured outputs can be switched off per provider", async () => {
  const fetch = stubFetch(() => jsonResponse(cityCompletion()));
  const runjobs = createRunJobs({ apiKey: "rk_obj", fetch, supportsStructuredOutputs: false });

  await generateObject({
    model: runjobs("Claude Sonnet 4.6"),
    schema: z.object({ city: z.string() }),
    prompt: "Name a city.",
  });

  // The escape hatch for a model the gateway rejects json_schema for.
  expect(fetch.calls[0].body.response_format?.type).not.toBe("json_schema");
});
