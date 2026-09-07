import { allowedValuesFor, getOptionsSchema, type FieldSchema, type Model } from "@runjobsai/sdk";
import { useMemo } from "react";

/**
 * Controls generated from what a model says it accepts.
 *
 * `/v1/models` returns a parameter schema per model, and its own
 * documentation is blunt about it: a field absent from that map is one
 * the model will reject. Hard-coding the knobs is how you end up
 * sending `resolution: "1K"` to a model whose enum says `1k`.
 *
 * Shared by the image, speech and transcription labs, which each face
 * the same problem with a different field set.
 */

/** Everything the schema can produce is JSON-safe by construction. */
export type FieldValue = string | number | boolean;

export type SchemaParams = Record<string, FieldValue>;

function isRenderable(field: FieldSchema): boolean {
  if (field.fields) return false; // nested / repeatable groups
  if (field.enum?.length) return true;
  return field.type === "int" || field.type === "float" || field.type === "bool" || field.type === "string";
}

/**
 * The renderable fields a model advertises, minus the ones the lab
 * drives with its own dedicated control.
 */
export function useSchemaFields(model: Model | undefined, handledElsewhere: string[]) {
  const skip = handledElsewhere.join(",");
  return useMemo(() => {
    if (!model) return [];
    const exclude = new Set(skip.split(","));
    const schema = getOptionsSchema(model);
    return Object.entries(schema?.inputs ?? {})
      .filter(([name, field]) => !exclude.has(name) && isRenderable(field))
      .sort(([, a], [, b]) => Number(a.ui?.["order"] ?? 0) - Number(b.ui?.["order"] ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, skip]);
}

/** Drop a value from the parameter set, or set it. */
export function setParam(params: SchemaParams, name: string, value: FieldValue | undefined): SchemaParams {
  const next = { ...params };
  if (value === undefined || value === "") delete next[name];
  else next[name] = value;
  return next;
}

export function SchemaField({
  name,
  field,
  model,
  value,
  onChange,
}: {
  name: string;
  field: FieldSchema;
  model: Model;
  value: FieldValue | undefined;
  onChange: (value: FieldValue | undefined) => void;
}) {
  const label = field.label ?? name;
  const allowed = allowedValuesFor(model, name);

  if (allowed?.length) {
    return (
      <label>
        {label}
        {field.help && <span className="hint"> {field.help}</span>}
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">— model default —</option>
          {allowed.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "bool") {
    return (
      <label className="check">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }

  if (field.type === "int" || field.type === "float") {
    return (
      <label style={{ flex: "0 0 7rem" }}>
        {label}
        <input
          type="number"
          {...(field.min !== undefined && { min: field.min })}
          {...(field.max !== undefined && { max: field.max })}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </label>
    );
  }

  return (
    <label>
      {label}
      {field.help && <span className="hint"> {field.help}</span>}
      <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={name} />
    </label>
  );
}
