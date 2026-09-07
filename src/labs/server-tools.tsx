import { streamText } from "ai";
import { useRef, useState } from "react";

import { useChatModel } from "../runjobs";
import { NeedsModel, Output, Panel, Status, Usage, describeError, runjobsUsage } from "../ui";

export const meta = {
  id: "server-tools",
  title: "Server tools",
  blurb:
    "The mirror image of the previous lab: these tools run on the gateway, not here. `web_search` and `web_fetch` ride in `providerOptions.runjobs` — the AI SDK forwards options it doesn't recognise to the provider verbatim, which is how a provider adds features the spec has no field for. They are billed per call, and show up separately in `toolCosts` below.",
  api: ["providerOptions.runjobs.serverTools", "providerMetadata.runjobs.toolCosts"],
};

const ALL_TOOLS = ["web_search", "web_fetch"] as const;

export default function ServerToolsLab() {
  const model = useChatModel();
  const abortRef = useRef<AbortController>(null);
  const [enabled, setEnabled] = useState<string[]>([...ALL_TOOLS]);
  const [prompt, setPrompt] = useState("What happened in the Vercel AI SDK's latest release? Cite sources.");
  const [text, setText] = useState("");
  const [stats, setStats] = useState<{
    usage?: ReturnType<typeof runjobsUsage>;
    tokens?: { inputTokens?: number; outputTokens?: number };
  }>({});
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  if (!model) return <NeedsModel>Connect and pick a chat model to run this.</NeedsModel>;

  async function run() {
    if (!model) return;
    setBusy(true);
    setText("");
    setStats({});
    setStatus({ text: "streaming…", kind: "" });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = streamText({
        model,
        prompt,
        abortSignal: controller.signal,
        providerOptions: {
          runjobs: { serverTools: enabled, maxServerIterations: 5 },
        },
      });

      for await (const chunk of result.textStream) setText((prev) => prev + chunk);

      setStats({ usage: runjobsUsage(await result.providerMetadata), tokens: await result.usage });
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
      <div className="row wrap">
        {ALL_TOOLS.map((name) => (
          <label className="check" key={name}>
            <input
              type="checkbox"
              checked={enabled.includes(name)}
              onChange={(e) =>
                setEnabled((prev) => (e.target.checked ? [...prev, name] : prev.filter((t) => t !== name)))
              }
            />
            <code>{name}</code>
          </label>
        ))}
      </div>
      <div className="row">
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <div className="row">
        <button className="primary" onClick={run} disabled={busy || enabled.length === 0}>
          {busy ? "Streaming…" : "Run"}
        </button>
        <button onClick={() => abortRef.current?.abort()} disabled={!busy}>
          Stop
        </button>
        <Status {...status} />
      </div>
      <Output text={text} />
      <Usage usage={stats.usage} tokens={stats.tokens} />
    </Panel>
  );
}
