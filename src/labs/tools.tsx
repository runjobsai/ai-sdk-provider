import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { useState } from "react";
import { z } from "zod";

import { useChatModel } from "../runjobs";
import { NeedsModel, Output, Panel, Status, Usage, describeError, runjobsUsage } from "../ui";

export const meta = {
  id: "tools",
  title: "Tool loop, step by step",
  blurb:
    "The same local tools as the chat lab, but through `generateText` so the loop is inspectable. `stopWhen: stepCountIs(5)` caps it. Each step below is one round trip: the model asks for a tool, the AI SDK runs it here in the browser, and feeds the result back. The gateway never sees your tool code — only its name, schema and return value.",
  api: ["generateText({ tools })", "stepCountIs()", "result.steps"],
};

const tools = {
  weather: tool({
    description: "Get the current weather for a city.",
    inputSchema: z.object({ city: z.string().describe("City name") }),
    execute: async ({ city }) => ({ city, celsius: 22, conditions: "clear" }),
  }),
  distance: tool({
    description: "Approximate distance between two cities in kilometres.",
    inputSchema: z.object({ from: z.string(), to: z.string() }),
    execute: async ({ from, to }) => ({ from, to, km: 1200 }),
  }),
};

/** Named so the result type can be inferred from it — `generateText` is
 *  generic over the tool set, so the bare return type doesn't fit. */
function runTools(model: LanguageModel, prompt: string) {
  return generateText({ model, prompt, tools, stopWhen: stepCountIs(5) });
}

type ToolRun = Awaited<ReturnType<typeof runTools>>;

export default function ToolsLab() {
  const model = useChatModel();
  const [prompt, setPrompt] = useState(
    "What's the weather in Shanghai, and how far is it from Beijing? Use the tools.",
  );
  const [result, setResult] = useState<ToolRun>();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  if (!model) return <NeedsModel>Connect and pick a chat model to run this.</NeedsModel>;

  async function run() {
    if (!model) return;
    setBusy(true);
    setText("");
    setResult(undefined);
    setStatus({ text: "running…", kind: "" });
    try {
      const generated = await runTools(model, prompt);
      setResult(generated);
      setText(generated.text);
      setStatus({ text: "done", kind: "ok" });
    } catch (err) {
      setText(describeError(err).text);
      setStatus({ text: "failed", kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="row">
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <div className="row">
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run"}
        </button>
        <Status {...status} />
      </div>

      <Output text={text} placeholder="final answer appears here" />
      <Usage
        usage={runjobsUsage(result?.providerMetadata)}
        tokens={result?.usage}
        steps={result?.steps.length}
      />

      {result && result.steps.length > 0 && (
        <details className="disclosure" open style={{ marginTop: "1rem" }}>
          <summary>Steps ({result.steps.length})</summary>
          {result.steps.map((step, i) => (
            <div className="tool-part" key={i} style={{ marginBottom: "0.5rem" }}>
              <b>step {i + 1}</b>
              <span className="tool-state">{step.finishReason}</span>
              {step.toolCalls.map((call, j) => (
                <div key={`c${j}`}>
                  ← {call.toolName}({JSON.stringify(call.input)})
                </div>
              ))}
              {step.toolResults.map((res, j) => (
                <div key={`r${j}`}>→ {JSON.stringify("output" in res ? res.output : res)}</div>
              ))}
              {step.text && <div style={{ marginTop: "0.3rem" }}>{step.text}</div>}
            </div>
          ))}
        </details>
      )}
    </Panel>
  );
}
