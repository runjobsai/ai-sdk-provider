import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { SpeechModelV4, SpeechModelV4CallOptions, SpeechModelV4Result, SharedV4Warning } from "@ai-sdk/provider";

import { resolveMediaUrl } from "./media-url.js";

/**
 * Text to speech, as a `SpeechModelV4`.
 *
 * `@ai-sdk/openai-compatible` supplies no speech model, so there is
 * nothing to delegate to.
 *
 * The response is not OpenAI's. Where OpenAI streams the audio back as
 * the raw body, the gateway answers with JSON carrying a URL, the same
 * way image generation does:
 *
 *   `{ audio_url: "data:<mime>;base64,…", usage }`
 *
 * so the bytes come from resolving that URL. Reading the body as an
 * ArrayBuffer instead yields the JSON text, which is a blob no audio
 * element can play.
 */

/** The gateway's `/v1/audio/speech` response. */
interface GatewaySpeechResponse {
  /** `data:` URL, or a hosted blob URL for larger clips. */
  audio_url?: string;
  usage?: { total_cost?: number };
}

export interface RunJobsSpeechModelOptions {
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

export function createRunJobsSpeechModel(options: RunJobsSpeechModelOptions): SpeechModelV4 {
  const { modelId, provider, baseURL, fetch: authedFetch, headers, optionsKey } = options;

  return {
    specificationVersion: "v4",
    provider,
    modelId,

    async doGenerate(call: SpeechModelV4CallOptions): Promise<SpeechModelV4Result> {
      const warnings: SharedV4Warning[] = [];

      // The gateway picks the language from the voice and the input
      // text; there is no field to carry this one.
      if (call.language !== undefined) {
        warnings.push({
          type: "unsupported",
          feature: "language",
          details: "Choose a voice for the target language instead.",
        });
      }

      // Provider options last so gateway-only fields (`emotion`, `pitch`,
      // `volume`, `timber`, `reference_audio_url`, `reference_text`) can
      // override anything derived from the generic options.
      const body = {
        model: modelId,
        input: call.text,
        ...(call.voice !== undefined && { voice: call.voice }),
        ...(call.outputFormat !== undefined && { response_format: call.outputFormat }),
        // The AI SDK's `instructions` is the gateway's `instruct_text`.
        ...(call.instructions !== undefined && { instruct_text: call.instructions }),
        ...(call.speed !== undefined && { speed: call.speed }),
        ...(call.providerOptions?.[optionsKey] ?? {}),
      };

      const response = await authedFetch(`${baseURL}/audio/speech`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
          ...stripUndefined(call.headers),
        },
        body: JSON.stringify(body),
        ...(call.abortSignal && { signal: call.abortSignal }),
      });

      if (!response.ok) {
        throw new Error(`runjobs speech generation failed: ${response.status} ${await safeText(response)}`);
      }

      const parsed = (await response.json()) as GatewaySpeechResponse;
      if (!parsed.audio_url) {
        throw new Error("runjobs speech generation returned no audio_url");
      }

      // `SpeechModelV4Result` has no media type field; the AI SDK
      // detects it from the bytes.
      const { bytes: audio } = await resolveMediaUrl(parsed.audio_url, authedFetch, "speech");

      return {
        audio,
        warnings,
        request: { body },
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
