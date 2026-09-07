import { streamText } from "ai";
import { useRef, useState } from "react";

import { useChatModel } from "../runjobs";
import { NeedsModel, Output, Panel, Status, Usage, describeError, runjobsUsage } from "../ui";

export const meta = {
  id: "stream-text",
  title: "streamText",
  blurb:
    "The same call, consumed as an async iterable. Note that cost, usage and steps are promises on the result — they settle when the stream ends, so you can await them after the loop. `abortSignal` is a plain AbortController, and cancelling mid-stream is a user action rather than an error.",
  api: ["streamText()", "result.textStream", "abortSignal"],
};

export default function StreamTextLab() {
  const model = useChatModel();
  const abortRef = useRef<AbortController>(null);
  const [prompt, setPrompt] = useState("Explain async iterators in three short sentences.");
  const [text, setText] = useState("");
  const [chunks, setChunks] = useState(0);
  const [stats, setStats] = useState<{
    usage?: ReturnType<typeof runjobsUsage>;
    tokens?: { inputTokens?: number; outputTokens?: number };
    steps?: number;
    ms?: number;
  }>({});
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  if (!model) return <NeedsModel>Connect and pick a chat model to run this.</NeedsModel>;

  async function run() {
    if (!model) return;
    setBusy(true);
    setText("");
    setChunks(0);
    setStats({});
    setStatus({ text: "streaming…", kind: "" });

    const controller = new AbortController();
    abortRef.current = controller;
    const started = performance.now();

    try {
      const result = streamText({ model, prompt, abortSignal: controller.signal });

      // The stream is the primary result; everything else settles after.
      for await (const chunk of result.textStream) {
        setText((prev) => prev + chunk);
        setChunks((n) => n + 1);
      }

      setStats({
        usage: runjobsUsage(await result.providerMetadata),
        tokens: await result.usage,
        steps: (await result.steps).length,
        ms: Math.round(performance.now() - started),
      });
      setStatus({ text: "done", kind: "ok" });
    } catch (err) {
      const { text: message, aborted } = describeError(err);
      if (aborted) setStatus({ text: "stopped", kind: "" });
      else {
        setText((prev) => `${prev}\n\n${message}`);
        setStatus({ text: "failed", kind: "err" });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <Panel>
      <div className="row">
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <div className="row">
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Streaming…" : "Run"}
        </button>
        <button onClick={() => abortRef.current?.abort()} disabled={!busy}>
          Stop
        </button>
        <Status {...status} />
        {chunks > 0 && <span className="status">{chunks} chunks</span>}
      </div>
      <Output text={text} />
      <Usage usage={stats.usage} tokens={stats.tokens} steps={stats.steps} ms={stats.ms} />
    </Panel>
  );
}
