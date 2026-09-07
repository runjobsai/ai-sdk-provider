/**
 * Vercel AI SDK provider for the RunJobs AI Gateway.
 *
 * Bridges `@runjobsai/sdk` into the AI SDK's `ProviderV4` spec, so every
 * model in the runjobs catalog works with `generateText`, `streamText`,
 * `generateObject`, `Agent`, `useChat`, and the rest of the ecosystem —
 * without giving up what the SDK does that a plain OpenAI-compatible
 * endpoint can't: sign in through runjobs.ai instead of minting an API
 * key, refresh the token underneath you, and report real cost per call.
 *
 * ```ts
 * import { createRunJobs } from "@runjobsai/ai-sdk-provider";
 * import { streamText } from "ai";
 *
 * const runjobs = createRunJobs({ authProvider: "runjobs" });
 *
 * const { textStream } = streamText({
 *   model: runjobs("Claude Sonnet 4.6"),
 *   prompt: "Explain async iterators.",
 * });
 * for await (const chunk of textStream) process.stdout.write(chunk);
 * ```
 */

export {
  createRunJobs,
  runjobs,
  type RunJobsProvider,
  type RunJobsProviderSettings,
  type RunJobsProviderOptions,
  type RunJobsServerTool,
} from "./provider.js";

export { createAuthedFetch, type AuthedFetchOptions } from "./auth-fetch.js";
export { runjobsMetadataExtractor } from "./metadata.js";
