import type { FetchFunction } from "@ai-sdk/provider-utils";
import type {
  ImageModelV4,
  ImageModelV4CallOptions,
  ImageModelV4Result,
  JSONArray,
  SharedV4Warning,
} from "@ai-sdk/provider";

import { resolveMediaUrl } from "./media-url.js";

/**
 * The gateway's image endpoint, as an `ImageModelV4`.
 *
 * This is the one model interface we implement ourselves rather than
 * delegating to `@ai-sdk/openai-compatible`, because the gateway and
 * OpenAI disagree about how a generated image comes back:
 *
 *   OpenAI   `{ data: [{ b64_json }] }`
 *   gateway  `{ data: [{ url }] }`
 *
 * and `url` is the only shape the gateway has. Pointing the stock
 * OpenAI-compatible image model at it fails on every call with
 * `Invalid JSON response`, because the mismatch is in the response
 * schema — there is no seam to hook a URL into.
 *
 * `ImageModelV4Result.images` is typed `string[] | Uint8Array[]`, so
 * the URL is resolved into bytes by `media-url.ts`.
 */

/** One image in the gateway's `/v1/images/generations` response. */
interface GatewayImage {
  /** Either a `data:` URL or a hosted blob URL. Never base64 on its own. */
  url: string;
  revised_prompt?: string;
  size?: string;
  /** Credit line that stock-library models require callers to display. */
  attribution?: string;
}

interface GatewayImageResponse {
  created?: number;
  data?: GatewayImage[];
  usage?: {
    total_cost?: number;
    generated_images?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface RunJobsImageModelOptions {
  modelId: string;
  /** Model identity, by convention `<provider>.<modality>`. */
  provider: string;
  /** `providerMetadata` key. The bare provider id, without the modality. */
  metadataKey: string;
  /** Gateway base URL including the `/v1` segment. */
  baseURL: string;
  /** The authed fetch. Used for the generation call and for blob downloads. */
  fetch: FetchFunction;
  headers?: Record<string, string>;
}

/**
 * Per-image extras the AI SDK has no field for. Mirrors what the
 * language model does with cost: anything the spec can't carry rides
 * along on `providerMetadata` under the provider's own key.
 *
 * `url` is included deliberately. Callers that only want to display
 * the image can use it directly rather than re-encoding the bytes.
 */
interface ImageMetadata {
  [key: string]: string | undefined;
  url: string;
  revisedPrompt?: string;
  size?: string;
  attribution?: string;
}

export function createRunJobsImageModel(options: RunJobsImageModelOptions): ImageModelV4 {
  const { modelId, provider, metadataKey, baseURL, fetch: authedFetch, headers } = options;

  return {
    specificationVersion: "v4",
    provider,
    modelId,

    // `generateImage` splits `n` into `ceil(n / maxImagesPerCall)`
    // separate requests, and treats `undefined` as 1 — which would turn
    // `n: 4` into four billed calls. The gateway takes `n` itself and
    // each model's real ceiling is advertised on `/v1/models`, so we
    // never split locally: one `generateImage` is one request, and an
    // unsupported `n` surfaces as the gateway's own error.
    maxImagesPerCall: Number.MAX_SAFE_INTEGER,

    async doGenerate(call: ImageModelV4CallOptions): Promise<ImageModelV4Result> {
      const warnings: SharedV4Warning[] = [];

      // `seed` has no gateway equivalent. Silently dropping it would
      // make results look non-reproducible for no stated reason.
      if (call.seed !== undefined) {
        warnings.push({ type: "unsupported", feature: "seed" });
      }
      // Image-to-image goes through `reference_image_urls` (URLs, not
      // bytes) or the separate edit endpoint, neither of which the
      // `files`/`mask` options map onto without an upload step.
      if (call.files?.length) {
        warnings.push({
          type: "unsupported",
          feature: "files",
          details: "Pass image URLs via providerOptions.runjobs.reference_image_urls instead.",
        });
      }
      if (call.mask) {
        warnings.push({
          type: "unsupported",
          feature: "mask",
          details: "Masked edits are only available through provider.client.image.edit().",
        });
      }

      // Provider options come last so the gateway's own knobs
      // (`resolution`, `aspect_ratio`, `style`, `reference_image_urls`)
      // can override anything derived from the generic call options.
      const body = {
        model: modelId,
        ...(call.prompt !== undefined && { prompt: call.prompt }),
        ...(call.n !== undefined && { n: call.n }),
        ...(call.size && { size: call.size }),
        ...(call.aspectRatio && { aspect_ratio: call.aspectRatio }),
        ...(call.providerOptions?.["runjobs"] ?? {}),
      };

      const response = await authedFetch(`${baseURL}/images/generations`, {
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
        throw new Error(`runjobs image generation failed: ${response.status} ${await safeText(response)}`);
      }

      const parsed = (await response.json()) as GatewayImageResponse;
      const data = parsed.data ?? [];

      // Resolved in parallel: a multi-image call would otherwise pay
      // the blob round trip once per image, in series.
      const images = await Promise.all(
        data.map(async (image) => (await resolveMediaUrl(image.url, authedFetch, "image")).bytes),
      );

      // Typed as JSONArray because that is what the spec's
      // `providerMetadata` accepts; `ImageMetadata` documents the shape.
      const metadata: JSONArray = data.map(
        (image): ImageMetadata => ({
          url: image.url,
          ...(image.revised_prompt !== undefined && { revisedPrompt: image.revised_prompt }),
          ...(image.size !== undefined && { size: image.size }),
          ...(image.attribution !== undefined && { attribution: image.attribution }),
        }),
      );

      return {
        images,
        warnings,
        response: {
          timestamp: parsed.created ? new Date(parsed.created * 1000) : new Date(),
          modelId,
          headers: Object.fromEntries(response.headers.entries()),
        },
        usage: {
          inputTokens: undefined,
          outputTokens: parsed.usage?.output_tokens,
          totalTokens: parsed.usage?.total_tokens,
        },
        // Only `images` survives: `generateImage` merges provider
        // metadata by pushing this array and dropping every other key
        // (except under the reserved `gateway` name). Cost therefore
        // can't ride along here the way it does on the language model —
        // it reaches callers on the event bus instead, where the authed
        // fetch already reports `usage.total_cost` as `costUSD`.
        providerMetadata: { [metadataKey]: { images: metadata } },
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
