import { cosineSimilarity, embedMany } from "ai";
import { useState } from "react";

import { useRunJobs } from "../runjobs";
import { NeedsModel, Panel, Status, describeError } from "../ui";

export const meta = {
  id: "embeddings",
  title: "Embeddings",
  blurb:
    "`provider.embeddingModel(id)` fills the second ProviderV4 slot, so `embedMany` and `cosineSimilarity` work exactly as documented. Pick an embedding model from the catalog — the chat model in the toolbar is not used here. Similarity is scored against the first line.",
  api: ["provider.embeddingModel()", "embedMany()", "cosineSimilarity()"],
};

const DEFAULT_INPUT = `a cat sleeping in the sun
a kitten napping in the warm light
the tokyo stock exchange closed higher
quicksort partitions an array around a pivot`;

export default function EmbeddingsLab() {
  const { provider, models } = useRunJobs();
  const embeddingModels = models.filter((m) => m.capability === "embedding");

  const [modelId, setModelId] = useState("");
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [scores, setScores] = useState<{ text: string; score: number; dims: number }[]>([]);
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  if (!provider) return <NeedsModel>Create a provider above to run this.</NeedsModel>;

  const selected = modelId || embeddingModels[0]?.id || "";

  async function run() {
    if (!provider || !selected) return;
    setBusy(true);
    setScores([]);
    setStatus({ text: "embedding…", kind: "" });
    try {
      const values = input.split("\n").map((line) => line.trim()).filter(Boolean);
      const { embeddings } = await embedMany({ model: provider.embeddingModel(selected), values });

      const first = embeddings[0];
      setScores(
        values.map((text, i) => ({
          text,
          dims: embeddings[i].length,
          score: first ? cosineSimilarity(first, embeddings[i]) : 0,
        })),
      );
      setStatus({ text: `${embeddings.length} vectors`, kind: "ok" });
    } catch (err) {
      setStatus({ text: describeError(err).text, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      {embeddingModels.length === 0 && (
        <div className="banner">
          No embedding models in the catalog yet — load it in the <b>Model catalog</b> lab first.
        </div>
      )}
      <div className="row">
        <label>
          Embedding model
          <select value={selected} onChange={(e) => setModelId(e.target.value)}>
            {embeddingModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>
          One text per line <span className="hint">scored against the first</span>
          <textarea rows={5} value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <button className="primary" onClick={run} disabled={busy || !selected}>
          {busy ? "Embedding…" : "Embed"}
        </button>
        <Status {...status} />
      </div>

      {scores.length > 0 && (
        <div style={{ marginTop: "0.9rem" }}>
          {scores.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: "center", marginBottom: "0.4rem" }}>
              <span style={{ width: "4.5rem", fontFamily: "var(--mono)", fontSize: "12px" }}>
                {s.score.toFixed(4)}
              </span>
              <span className="sim" style={{ width: `${Math.max(0, s.score) * 120}px` }} />
              <span style={{ flex: 1, minWidth: 0 }}>{s.text}</span>
              <span className="hint" style={{ fontSize: "0.75rem" }}>
                {s.dims}d
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
