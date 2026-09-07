import type { Model } from "@runjobsai/sdk";
import { experimental_transcribe as transcribe } from "ai";
import { useEffect, useRef, useState } from "react";

import { useRunJobs } from "../runjobs";
import { SchemaField, setParam, useSchemaFields, type SchemaParams } from "../schema-form";
import { NeedsModel, Output, Panel, Status, describeError } from "../ui";

export const meta = {
  id: "transcription",
  title: "Speech to text",
  blurb:
    "`provider.transcriptionModel(id)` fills the other audio slot. This is the only endpoint the provider talks to that takes a multipart upload rather than JSON. Segment timings only come back when the model is asked for a verbose transcript, which is a schema field rather than an AI SDK one — set `response_format` below and watch the segment list appear.",
  api: ["provider.transcriptionModel()", "transcribe()", "result.segments"],
};

export default function TranscriptionLab() {
  const { provider, models } = useRunJobs();
  const transcriptionModels = models.filter((m) => m.capability === "speech_to_text");

  const [modelId, setModelId] = useState("");
  const [file, setFile] = useState<File>();
  const [params, setParams] = useState<SchemaParams>({});

  const [text, setText] = useState("");
  const [segments, setSegments] = useState<{ text: string; startSecond: number; endSecond: number }[]>([]);
  const [detail, setDetail] = useState<{ language?: string; duration?: number }>({});
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const selected: Model | undefined = transcriptionModels.find((m) => m.id === modelId) ?? transcriptionModels[0];

  // `file` is the upload control; everything else comes from the schema.
  const fields = useSchemaFields(selected, ["file"]);

  useEffect(() => setParams({}), [selected?.id]);

  if (!provider) return <NeedsModel>Create a provider above to run this.</NeedsModel>;

  async function run() {
    if (!provider || !selected || !file) return;
    setBusy(true);
    setText("");
    setSegments([]);
    setDetail({});
    setStatus({ text: "transcribing…", kind: "" });

    try {
      const result = await transcribe({
        model: provider.transcriptionModel(selected.id),
        // `transcribe` detects the media type from the bytes and passes
        // it down to the model; there is no field for it here.
        audio: new Uint8Array(await file.arrayBuffer()),
        ...(Object.keys(params).length > 0 && { providerOptions: { runjobs: params } }),
      });

      setText(result.text);
      setSegments(result.segments);
      setDetail({ language: result.language, duration: result.durationInSeconds });
      setStatus({ text: "done", kind: "ok" });
    } catch (err) {
      setStatus({ text: describeError(err).text, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      {transcriptionModels.length === 0 && (
        <div className="banner">
          No speech-to-text models in the catalog yet — load it in the <b>Model catalog</b> lab first.
        </div>
      )}

      <div className="row wrap">
        <label>
          Transcription model
          <select value={selected?.id ?? ""} onChange={(e) => setModelId(e.target.value)}>
            {transcriptionModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Audio file
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*"
            onChange={(e) => setFile(e.target.files?.[0])}
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
        <button className="primary" onClick={run} disabled={busy || !selected || !file}>
          {busy ? "Transcribing…" : "Transcribe"}
        </button>
        {file && (
          <span className="status">
            {file.name} · {(file.size / 1024).toFixed(0)} kB · {file.type || "unknown type"}
          </span>
        )}
        <Status {...status} />
      </div>

      <Output text={text} placeholder="the transcript appears here" />

      {(detail.language || detail.duration !== undefined) && (
        <div className="usage">
          {detail.language && (
            <span>
              language <b>{detail.language}</b>
            </span>
          )}
          {detail.duration !== undefined && (
            <span>
              duration <b>{detail.duration}s</b>
            </span>
          )}
          <span>
            segments <b>{segments.length}</b>
          </span>
        </div>
      )}

      {segments.length > 0 && (
        <details className="disclosure" open style={{ marginTop: "1rem" }}>
          <summary>Segments ({segments.length})</summary>
          {segments.map((segment, i) => (
            <div className="tool-part" key={i} style={{ marginBottom: "0.35rem" }}>
              <b>
                {segment.startSecond.toFixed(2)}s → {segment.endSecond.toFixed(2)}s
              </b>
              <div>{segment.text}</div>
            </div>
          ))}
        </details>
      )}
    </Panel>
  );
}
