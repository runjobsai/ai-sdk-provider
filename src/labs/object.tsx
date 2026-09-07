import { streamObject } from "ai";
import { useRef, useState } from "react";
import { z } from "zod";

import { useChatModel } from "../runjobs";
import { NeedsModel, Output, Panel, Status, Usage, describeError, runjobsUsage } from "../ui";

export const meta = {
  id: "object",
  title: "Structured output",
  blurb:
    "A zod schema in, a typed object out, filled in as it streams. Note what this lab does NOT use: `useObject`. That hook takes an `api` URL and nothing else — unlike `useChat` it has no transport seam, so it cannot run without a server. `streamObject` from ai core has no such constraint, and `partialObjectStream` gives you the same progressive fill with a few lines of state.",
  api: ["streamObject()", "partialObjectStream", "zod schema"],
};

const schema = z.object({
  language: z.string().describe("The programming language"),
  releasedIn: z.number().describe("Year of first public release"),
  createdBy: z.array(z.string()).describe("The people who created it"),
  strengths: z.array(z.string()).describe("Three things it is genuinely good at"),
  oneLiner: z.string().describe("A single sentence a beginner would understand"),
});

export default function ObjectLab() {
  const model = useChatModel();
  const abortRef = useRef<AbortController>(null);
  const [subject, setSubject] = useState("Rust");
  const [object, setObject] = useState<unknown>();
  const [error, setError] = useState("");
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
    setObject(undefined);
    setError("");
    setStats({});
    setStatus({ text: "streaming…", kind: "" });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = streamObject({
        model,
        schema,
        abortSignal: controller.signal,
        prompt: `Describe the ${subject} programming language.`,
      });

      // Every chunk is the whole object so far — a DeepPartial of the
      // schema, so rendering it is just JSON until the last one.
      for await (const partial of result.partialObjectStream) setObject(partial);

      // Throws if the finished object doesn't validate against the schema.
      setObject(await result.object);
      setStats({ usage: runjobsUsage(await result.providerMetadata), tokens: await result.usage });
      setStatus({ text: "valid", kind: "ok" });
    } catch (err) {
      const { text: message, aborted } = describeError(err);
      if (aborted) setStatus({ text: "stopped", kind: "" });
      else {
        setError(message);
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
        <label style={{ flex: 1 }}>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Streaming…" : "Run"}
        </button>
        <button onClick={() => abortRef.current?.abort()} disabled={!busy}>
          Stop
        </button>
        <Status {...status} />
      </div>

      <Output
        text={error || (object ? JSON.stringify(object, null, 2) : "")}
        placeholder="the object fills in as it streams"
      />
      <Usage usage={stats.usage} tokens={stats.tokens} />
    </Panel>
  );
}
