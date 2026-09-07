import { type Model } from "@runjobsai/sdk";
import { generateImage } from "ai";
import { useEffect, useRef, useState } from "react";

import { useRunJobs } from "../runjobs";
import { SchemaField, setParam, useSchemaFields, type SchemaParams } from "../schema-form";
import { NeedsModel, Panel, Status, describeError } from "../ui";

export const meta = {
  id: "image",
  title: "Image generation",
  blurb:
    "`provider.imageModel(id)` fills the third ProviderV4 slot. The controls below are not hard-coded: every image model advertises its own parameter schema on `/v1/models`, and a field missing from that schema is one the model will reject. The form is generated from it, so switching models changes the controls. Everything except `n` reaches the gateway through `providerOptions.runjobs`.",
  api: ["provider.imageModel()", "generateImage()", "getOptionsSchema()", "providerOptions.runjobs"],
};

interface ImageMeta {
  url?: string;
  revisedPrompt?: string;
  size?: string;
  attribution?: string;
}

export default function ImageLab() {
  const { provider, models } = useRunJobs();
  const imageModels = models.filter((m) => m.capability === "image_generation");

  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("a gentle ocean wave at sunrise, photorealistic");
  const [n, setN] = useState(1);
  const [params, setParams] = useState<SchemaParams>({});

  const [urls, setUrls] = useState<string[]>([]);
  const [meta, setMeta] = useState<ImageMeta[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  const selected: Model | undefined = imageModels.find((m) => m.id === modelId) ?? imageModels[0];

  // `prompt` and `n` have their own controls; everything else the model
  // advertises is rendered from its schema.
  const fields = useSchemaFields(selected, ["prompt", "n"]);

  // A knob set for one model is meaningless for the next.
  useEffect(() => setParams({}), [selected?.id]);

  // Object URLs are the only thing here that leaks if left alone.
  const created = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of created.current) URL.revokeObjectURL(url);
    },
    [],
  );

  if (!provider) return <NeedsModel>Create a provider above to run this.</NeedsModel>;

  async function run() {
    if (!provider || !selected) return;
    setBusy(true);
    setUrls([]);
    setMeta([]);
    setWarnings([]);
    setStatus({ text: "generating…", kind: "" });

    for (const url of created.current) URL.revokeObjectURL(url);
    created.current = [];

    try {
      const result = await generateImage({
        model: provider.imageModel(selected.id),
        prompt,
        n,
        ...(Object.keys(params).length > 0 && { providerOptions: { runjobs: params } }),
      });

      // The provider hands back bytes; the browser needs a URL to render.
      const objectUrls = result.images.map((image) => {
        const url = URL.createObjectURL(new Blob([image.uint8Array as BlobPart]));
        created.current.push(url);
        return url;
      });

      setUrls(objectUrls);
      setMeta((result.providerMetadata?.["runjobs"]?.["images"] as ImageMeta[] | undefined) ?? []);
      setWarnings(result.warnings.map((w) => ("feature" in w ? `${w.type}: ${w.feature}` : w.type)));
      setStatus({ text: `${objectUrls.length} image(s)`, kind: "ok" });
    } catch (err) {
      setStatus({ text: describeError(err).text, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      {imageModels.length === 0 && (
        <div className="banner">
          No image models in the catalog yet — load it in the <b>Model catalog</b> lab first.
        </div>
      )}

      <div className="row wrap">
        <label>
          Image model
          <select value={selected?.id ?? ""} onChange={(e) => setModelId(e.target.value)}>
            {imageModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "0 0 5rem" }}>
          n
          <input
            type="number"
            min={1}
            max={4}
            value={n}
            onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
      </div>

      {fields.length > 0 && (
        <div className="row wrap">
          {fields.map(([name, field]) => (
            <SchemaField
              key={name}
              name={name}
              field={field}
              model={selected!}
              value={params[name]}
              onChange={(value) => setParams((prev) => setParam(prev, name, value))}
            />
          ))}
        </div>
      )}

      <div className="row">
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>

      <div className="row">
        <button className="primary" onClick={run} disabled={busy || !selected}>
          {busy ? "Generating…" : "Generate"}
        </button>
        <Status {...status} />
      </div>

      {warnings.length > 0 && <div className="banner">warnings: {warnings.join(", ")}</div>}

      {urls.length > 0 && (
        <div className="split" style={{ marginTop: "0.9rem" }}>
          {urls.map((url, i) => (
            <figure key={url} style={{ margin: 0 }}>
              <img
                src={url}
                alt={meta[i]?.revisedPrompt ?? prompt}
                style={{ width: "100%", borderRadius: "9px", border: "1px solid var(--line)" }}
              />
              {(meta[i]?.revisedPrompt || meta[i]?.attribution || meta[i]?.size) && (
                <figcaption className="hint" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
                  {meta[i]?.size && <div>{meta[i]?.size}</div>}
                  {meta[i]?.revisedPrompt && <div>revised: {meta[i]?.revisedPrompt}</div>}
                  {/* Stock-library models require this line to be shown. */}
                  {meta[i]?.attribution && <div>{meta[i]?.attribution}</div>}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </Panel>
  );
}
