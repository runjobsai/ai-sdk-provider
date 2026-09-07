import type { FetchFunction } from "@ai-sdk/provider-utils";
import type {
  SharedV4Warning,
  TranscriptionModelV4,
  TranscriptionModelV4CallOptions,
  TranscriptionModelV4Result,
} from "@ai-sdk/provider";

import { base64ToBytes } from "./bytes.js";

/**
 * Speech to text, as a `TranscriptionModelV4`.
 *
 * Unlike every other endpoint the provider talks to, this one takes a
 * multipart upload rather than JSON, so the body is a `FormData` and
 * the request must not set its own `content-type` — the runtime writes
 * that header itself, including the boundary.
 *
 * `doStream` is deliberately absent. It is optional in the spec, and
 * the gateway's streaming transcription is a different endpoint with
 * its own protocol; `provider.client.audio` covers it until that is
 * mapped properly.
 */

export interface RunJobsTranscriptionModelOptions {
  modelId: string;
  /** Model identity, by convention `<provider>.<modality>`. */
  provider: string;
  /** Gateway base URL including the `/v1` segment. */
  baseURL: string;
  fetch: FetchFunction;
  headers?: Record<string, string>;
  /** `providerOptions` key the extra gateway fields arrive under. */
  optionsKey: string;
}

/** Verbose-JSON transcription payload, as OpenAI shaped it. */
interface GatewayTranscription {
  text?: string;
  language?: string;
  duration?: number;
  segments?: { text?: string; start?: number; end?: number }[];
}

/** A filename is required by the multipart field; the extension is the
 *  only hint some upstreams use to pick a decoder. */
function filenameFor(mediaType: string): string {
  const subtype = mediaType.split("/")[1]?.split(";")[0] ?? "bin";
  const extension = subtype === "mpeg" ? "mp3" : subtype === "x-wav" ? "wav" : subtype;
  return `audio.${extension}`;
}

export function createRunJobsTranscriptionModel(
  options: RunJobsTranscriptionModelOptions,
): TranscriptionModelV4 {
  const { modelId, provider, baseURL, fetch: authedFetch, headers, optionsKey } = options;

  return {
    specificationVersion: "v4",
    provider,
    modelId,

    async doGenerate(call: TranscriptionModelV4CallOptions): Promise<TranscriptionModelV4Result> {
      const warnings: SharedV4Warning[] = [];

      const bytes = typeof call.audio === "string" ? base64ToBytes(call.audio) : call.audio;

      const form = new FormData();
      form.append("model", modelId);
      form.append("file", new Blob([bytes as BlobPart], { type: call.mediaType }), filenameFor(call.mediaType));

      // `language`, `prompt`, `response_format` and
      // `timestamp_granularities` have no AI SDK field and arrive here.
      for (const [key, value] of Object.entries(call.providerOptions?.[optionsKey] ?? {})) {
        if (value === undefined || value === null) continue;
        // Multipart carries no types: arrays go one entry per key, the
        // way `timestamp_granularities[]` is conventionally sent.
        if (Array.isArray(value)) for (const item of value) form.append(key, String(item));
        else form.append(key, String(value));
      }

      const response = await authedFetch(`${baseURL}/audio/transcriptions`, {
        method: "POST",
        // No `content-type` here on purpose: setting it would omit the
        // multipart boundary the runtime generates, and the gateway
        // would fail to parse the body.
        headers: { ...headers, ...stripUndefined(call.headers) },
        body: form,
        ...(call.abortSignal && { signal: call.abortSignal }),
      });

      if (!response.ok) {
        throw new Error(`runjobs transcription failed: ${response.status} ${await safeText(response)}`);
      }

      const parsed = (await response.json()) as GatewayTranscription;

      // Segments only come back under `response_format: "verbose_json"`.
      const segments = (parsed.segments ?? []).map((segment) => ({
        text: segment.text ?? "",
        startSecond: segment.start ?? 0,
        endSecond: segment.end ?? 0,
      }));

      return {
        text: parsed.text ?? "",
        segments,
        language: parsed.language,
        durationInSeconds: parsed.duration,
        warnings,
        response: {
          timestamp: new Date(),
          modelId,
          headers: Object.fromEntries(response.headers.entries()),
        },
      };
    },
  };
}

/** The spec types per-call headers as possibly-undefined values. */
function stripUndefined(headers: Record<string, string | undefined> | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] != null));
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "";
  }
}
