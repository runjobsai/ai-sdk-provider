import type { Model } from "@runjobsai/sdk";
import { experimental_generateSpeech as generateSpeech } from "ai";
import { useEffect, useRef, useState } from "react";

import { useRunJobs } from "../runjobs";
import { SchemaField, setParam, useSchemaFields, type SchemaParams } from "../schema-form";
import { NeedsModel, Panel, Status, describeError } from "../ui";

export const meta = {
  id: "speech",
  title: "Text to speech",
  blurb:
    "`provider.speechModel(id)` fills one of the two optional audio slots. The AI SDK's field names are not the gateway's — `instructions` becomes `instruct_text`, `outputFormat` becomes `response_format` — and the voice controls the gateway adds on top (`emotion`, `pitch`, `volume`, `timber`) have no AI SDK field at all, so they come from the model's own schema. Cost shows up on the events panel below.",
  api: ["provider.speechModel()", "generateSpeech()", "providerOptions.runjobs"],
};

export default function SpeechLab() {
  const { provider, models } = useRunJobs();
  const speechModels = models.filter((m) => m.capability === "text_to_speech");

  const [modelId, setModelId] = useState("");
  const [text, setText] = useState("RunJobs 网关现在可以通过 AI SDK 直接合成语音了。");
  const [voice, setVoice] = useState("");
  const [params, setParams] = useState<SchemaParams>({});

  const [audioUrl, setAudioUrl] = useState<string>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  const selected: Model | undefined = speechModels.find((m) => m.id === modelId) ?? speechModels[0];

  // `input` and `voice` have dedicated controls above.
  const fields = useSchemaFields(selected, ["input", "voice"]);

  // The catalog advertises the voices each model actually has.
  const voices = selected?.available_voices ?? [];

  useEffect(() => {
    setParams({});
    setVoice("");
  }, [selected?.id]);

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
    setAudioUrl(undefined);
    setWarnings([]);
    setStatus({ text: "synthesising…", kind: "" });

    for (const url of created.current) URL.revokeObjectURL(url);
    created.current = [];

    try {
      const result = await generateSpeech({
        model: provider.speechModel(selected.id),
        text,
        ...(voice && { voice }),
        ...(Object.keys(params).length > 0 && { providerOptions: { runjobs: params } }),
      });

      const url = URL.createObjectURL(
        new Blob([result.audio.uint8Array as BlobPart], { type: result.audio.mediaType || "audio/mpeg" }),
      );
      created.current.push(url);
      setAudioUrl(url);
      setWarnings(result.warnings.map((w) => ("feature" in w ? `${w.type}: ${w.feature}` : w.type)));
      setStatus({ text: `${result.audio.uint8Array.length} bytes`, kind: "ok" });
    } catch (err) {
      setStatus({ text: describeError(err).text, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      {speechModels.length === 0 && (
        <div className="banner">
          No text-to-speech models in the catalog yet — load it in the <b>Model catalog</b> lab first.
        </div>
      )}

      <div className="row wrap">
        <label>
          Speech model
          <select value={selected?.id ?? ""} onChange={(e) => setModelId(e.target.value)}>
            {speechModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Voice <span className="hint">from the catalog</span>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={voices.length === 0}>
            <option value="">— model default —</option>
            {voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
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
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      <div className="row">
        <button className="primary" onClick={run} disabled={busy || !selected || !text.trim()}>
          {busy ? "Synthesising…" : "Speak"}
        </button>
        <Status {...status} />
      </div>

      {warnings.length > 0 && <div className="banner">warnings: {warnings.join(", ")}</div>}

      {audioUrl && (
        <audio controls src={audioUrl} style={{ width: "100%", marginTop: "0.9rem" }}>
          Your browser cannot play this audio.
        </audio>
      )}
    </Panel>
  );
}
