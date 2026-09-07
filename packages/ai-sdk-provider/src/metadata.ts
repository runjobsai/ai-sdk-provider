import type { MetadataExtractor } from "@ai-sdk/openai-compatible";
import type { SharedV4ProviderMetadata } from "@ai-sdk/provider";

/**
 * Surfaces the gateway's billing extensions through the AI SDK.
 *
 * `LanguageModelV4Usage` is deliberately narrow — input / output /
 * total tokens and nothing else — so `usage.total_cost` and the
 * per-tool `usage.tool_costs` breakdown would be dropped on the floor
 * by the stock OpenAI-compatible mapping. Cost-per-call is one of the
 * main reasons to run through runjobs rather than hitting a vendor
 * directly, so we re-attach it as provider metadata:
 *
 * ```ts
 * const { providerMetadata } = await generateText({ model: runjobs("Claude Sonnet 4.6"), ... });
 * providerMetadata?.runjobs.totalCost;   // 0.0123 (USD, model + server tools)
 * providerMetadata?.runjobs.toolCosts;   // [{ name: "web_search", count: 2, cost: 0.01 }]
 * ```
 *
 * Streaming and non-streaming both land in the same shape. In a
 * stream the gateway only sends `usage` on the final chunk (the SDK
 * forces `stream_options.include_usage`), so the stream extractor
 * just keeps the last one it saw.
 */
interface GatewayUsage {
  total_cost?: number;
  tool_costs?: { name: string; count: number; cost: number }[];
}

const PROVIDER_KEY = "runjobs";

function toMetadata(usage: GatewayUsage | undefined): SharedV4ProviderMetadata | undefined {
  if (!usage) return undefined;

  const entries: Record<string, unknown> = {};
  if (typeof usage.total_cost === "number") entries["totalCost"] = usage.total_cost;
  if (Array.isArray(usage.tool_costs) && usage.tool_costs.length > 0) {
    entries["toolCosts"] = usage.tool_costs;
  }

  if (Object.keys(entries).length === 0) return undefined;
  return { [PROVIDER_KEY]: entries } as SharedV4ProviderMetadata;
}

function readUsage(body: unknown): GatewayUsage | undefined {
  return (body as { usage?: GatewayUsage } | null | undefined)?.usage;
}

export const runjobsMetadataExtractor: MetadataExtractor = {
  async extractMetadata({ parsedBody }) {
    return toMetadata(readUsage(parsedBody));
  },

  createStreamExtractor() {
    let usage: GatewayUsage | undefined;
    return {
      processChunk(parsedChunk) {
        const u = readUsage(parsedChunk);
        // Only the final chunk carries usage; earlier ones have none.
        if (u) usage = u;
      },
      buildMetadata() {
        return toMetadata(usage);
      },
    };
  },
};
