import { createAuthedFetch, createRunJobs } from "@runjobsai/ai-sdk-provider";
import { generateText, stepCountIs, streamText, tool } from "ai";
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
