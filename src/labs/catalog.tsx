import { useMemo, useState } from "react";

import { useRunJobs } from "../runjobs";
import { NeedsModel, Panel } from "../ui";

export const meta = {
  id: "catalog",
  title: "Model catalog",
  blurb:
    "The escape hatch. `provider.client` is the underlying @runjobsai/sdk client, for everything the AI SDK has no interface for — a model catalog being the first thing you hit. Note that the SDK attaches a token to every request, including this one, so under browser auth the catalog triggers sign-in like any other call even though the endpoint itself is public.",
  api: ["provider.client.models.list()"],
};

export default function CatalogLab() {
  const { provider, models, modelsLoading, modelsError, reloadModels, modelId, setModelId } = useRunJobs();
  const [filter, setFilter] = useState("");

  const byCapability = useMemo(() => {
    const groups = new Map<string, typeof models>();
    for (const m of models) {
      if (filter && !m.id.toLowerCase().includes(filter.toLowerCase())) continue;
      const list = groups.get(m.capability) ?? [];
      list.push(m);
      groups.set(m.capability, list);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [models, filter]);

  if (!provider) return <NeedsModel>Create a provider above to load the catalog.</NeedsModel>;

  return (
    <Panel>
      <div className="row wrap">
        <label style={{ flex: 1 }}>
          Filter
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="claude, gemini, embed…" />
        </label>
        <button onClick={reloadModels} disabled={modelsLoading}>
          {modelsLoading ? "loading…" : "Reload"}
        </button>
      </div>

      {modelsError && <p className="status err">{modelsError}</p>}

      <p className="empty-note">
        {models.length} models · click one to make it the active chat model for the other labs
      </p>

      {byCapability.map(([capability, list]) => (
        <div key={capability} style={{ marginTop: "0.9rem" }}>
          <h2>
            {capability} <span className="hint">({list.length})</span>
          </h2>
          <div className="row wrap" style={{ gap: "0.35rem" }}>
            {list.map((m) => {
              const selectable = m.capability === "text" || m.capability === "vision";
              return (
                <button
                  key={m.id}
                  onClick={() => selectable && setModelId(m.id)}
                  disabled={!selectable}
                  className={m.id === modelId ? "primary" : ""}
                  title={selectable ? "Use as the active chat model" : "Not a chat model"}
                >
                  {m.id}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </Panel>
  );
}
