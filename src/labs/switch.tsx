import { createDeepSeek } from "@ai-sdk/deepseek";
import { streamText, type LanguageModel } from "ai";
import { useMemo, useRef, useState } from "react";

import { useRunJobs } from "../runjobs";
import { NeedsModel, Output, Panel, Status, Usage, describeError, runjobsUsage } from "../ui";

export const meta = {
  id: "switch",
  title: "Swapping providers",
  blurb:
    "The same `streamText` call, run against runjobs or against DeepSeek's own provider. Only the `model` argument differs — everything after it is identical, which is the claim this lab exists to check. Note what else differs: the DeepSeek key has to be inlined into this bundle, while the runjobs side has no key at all.",
  api: ["createDeepSeek()", "streamText()", "LanguageModel"],
};

/**
 * Vite inlines `VITE_*` into the bundle at build time. For DeepSeek
 * that is unavoidable without a backend, and it is exactly the problem
 * `authProvider: "runjobs"` removes — so the lab leaves it visible
 * rather than hiding it behind a proxy.
 */
const DEEPSEEK_KEY = import.meta.env["VITE_DEEPSEEK_API_KEY"] as string | undefined;

type Vendor = "runjobs" | "deepseek";

export default function SwitchLab() {
  const { provider, modelId } = useRunJobs();
  const [vendor, setVendor] = useState<Vendor>("runjobs");
  const [deepseekModel, setDeepseekModel] = useState("deepseek-chat");
  const [prompt, setPrompt] = useState("In one sentence: what is a monoid?");

  const [text, setText] = useState("");
  const [stats, setStats] = useState<{
    usage?: ReturnType<typeof runjobsUsage>;
    tokens?: { inputTokens?: number; outputTokens?: number };
    ms?: number;
  }>({});
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController>(null);

  // Built once per key change. Without a backend there is nowhere else
  // for this key to live.
  const deepseek = useMemo(
    () => (DEEPSEEK_KEY ? createDeepSeek({ apiKey: DEEPSEEK_KEY }) : undefined),
    [],
  );

  if (!provider) return <NeedsModel>Create a provider above to run this.</NeedsModel>;

  const model: LanguageModel | undefined =
    vendor === "runjobs"
      ? modelId
        ? provider(modelId)
        : undefined
      : deepseek?.(deepseekModel);

  async function run() {
    if (!model) return;
    setBusy(true);
    setText("");
    setStats({});
    setStatus({ text: "streaming…", kind: "" });

    const controller = new AbortController();
    abortRef.current = controller;
    const started = performance.now();

    try {
      // ---- everything below this line is vendor-agnostic ----
      const result = streamText({ model, prompt, abortSignal: controller.signal });

      for await (const chunk of result.textStream) setText((prev) => prev + chunk);

      setStats({
        usage: runjobsUsage(await result.providerMetadata),
        tokens: await result.usage,
        ms: Math.round(performance.now() - started),
      });
      setStatus({ text: "done", kind: "ok" });
      // ---- end vendor-agnostic section ----
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

  const missingKey = vendor === "deepseek" && !deepseek;

  return (
    <Panel>
      <div className="row wrap">
        <label>
          Provider
          <select value={vendor} onChange={(e) => setVendor(e.target.value as Vendor)}>
            <option value="runjobs">runjobs — no key in the bundle</option>
            <option value="deepseek">DeepSeek — key inlined at build time</option>
          </select>
        </label>

        {vendor === "runjobs" ? (
          <label>
            Model <span className="hint">from the toolbar</span>
            <input value={modelId || "— none —"} readOnly />
          </label>
        ) : (
          <label>
            Model
            <select value={deepseekModel} onChange={(e) => setDeepseekModel(e.target.value)}>
              <option value="deepseek-chat">deepseek-chat</option>
              <option value="deepseek-reasoner">deepseek-reasoner</option>
            </select>
          </label>
        )}
      </div>

      {missingKey && (
        <div className="banner err">
          <code>VITE_DEEPSEEK_API_KEY</code> is not set. Copy <code>.env.example</code> to{" "}
          <code>.env.local</code>, put a key in it, and restart <code>pnpm dev</code>.
        </div>
      )}

      <div className="banner">
        <b>What changes between the two:</b> only the <code>model</code> passed to{" "}
        <code>streamText</code>. What also changes, and does not show up in the code: runjobs signs
        in through the browser and reports cost per call, while the DeepSeek key is compiled into
        the JavaScript this page is running and its provider reports no cost.
      </div>

      <div className="row">
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>

      <div className="row">
        <button className="primary" onClick={run} disabled={busy || !model}>
          {busy ? "Streaming…" : `Run on ${vendor}`}
        </button>
        <button onClick={() => abortRef.current?.abort()} disabled={!busy}>
          Stop
        </button>
        <Status {...status} />
      </div>

      <Output text={text} />
      <Usage usage={stats.usage} tokens={stats.tokens} ms={stats.ms} />

      {stats.tokens && !stats.usage?.totalCost && vendor === "deepseek" && (
        <p className="empty-note">
          No cost reported — the AI SDK has no field for it, and only a provider that adds one to{" "}
          <code>providerMetadata</code> can supply it.
        </p>
      )}
    </Panel>
  );
}
