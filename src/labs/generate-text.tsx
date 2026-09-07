import { generateText } from "ai";
import { useState } from "react";

import { useChatModel } from "../runjobs";
import { NeedsModel, Output, Panel, Status, Usage, describeError, runjobsUsage } from "../ui";

export const meta = {
  id: "generate-text",
  title: "generateText",
  blurb:
    "One call, one answer, no streaming. The plainest possible proof that the provider is a normal AI SDK provider: nothing here mentions runjobs except where the model came from. Cost comes back on `providerMetadata.runjobs`, which is the one thing a stock OpenAI-compatible provider can't give you.",
  api: ["generateText()", "result.providerMetadata.runjobs"],
};

export default function GenerateTextLab() {
  const model = useChatModel();
  const [prompt, setPrompt] = useState("What is the latest stable version of Go? Answer in one sentence.");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof generateText>>>();
  const [ms, setMs] = useState<number>();
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  if (!model) return <NeedsModel>Connect and pick a chat model to run this.</NeedsModel>;

  async function run() {
    if (!model) return;
    setBusy(true);
    setText("");
    setResult(undefined);
    setStatus({ text: "running…", kind: "" });
    const started = performance.now();
    try {
      const generated = await generateText({ model, prompt });
      setText(generated.text);
      setResult(generated);
      setMs(Math.round(performance.now() - started));
      setStatus({ text: "done", kind: "ok" });
    } catch (err) {
      const { text: message } = describeError(err);
      setText(message);
      setStatus({ text: "failed", kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="row">
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <div className="row">
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run"}
        </button>
        <Status {...status} />
      </div>
      <Output text={text} />
      <Usage
        usage={runjobsUsage(result?.providerMetadata)}
        tokens={result?.usage}
        steps={result?.steps.length}
        ms={ms}
      />
    </Panel>
  );
}
