import type { FetchFunction } from "@ai-sdk/provider-utils";

import { base64ToBytes } from "./bytes.js";

/**
 * The gateway hands back generated media as a URL rather than as
 * inline base64 or a raw body, in two transport modes:
 *
 *   `data:<mime>;base64,<payload>`   inline, decoded locally
 *   `https://…/v1/blobs/<id>`        hosted, one extra GET
 *
 * Every AI SDK result type wants bytes, so both shapes have to be
 * resolved here. `decodeMediaUrl` from `@runjobsai/sdk` does the same
 * job, but always through the global `fetch`: no bearer token, no
 * 401-refresh-retry, no event bus, and no way for a caller-supplied
 * `fetch` to intercept it. Hence this.
 */

const DATA_URL = /^data:([^;,]*)(;base64)?,/i;

/** Decode a `data:` URL locally. Returns undefined for any other scheme. */
function decodeDataUrl(url: string): { bytes: Uint8Array; contentType: string } | undefined {
  const match = DATA_URL.exec(url);
  if (!match) return undefined;

  const payload = url.slice(match[0].length);
  const contentType = match[1] || "application/octet-stream";

  // Percent-encoded rather than base64 is rare, but legal.
  const bytes = match[2] ? base64ToBytes(payload) : new TextEncoder().encode(decodeURIComponent(payload));
  return { bytes, contentType };
}

export async function resolveMediaUrl(
  url: string,
  authedFetch: FetchFunction,
  what: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const inline = decodeDataUrl(url);
  if (inline) return inline;

  const response = await authedFetch(url);
  if (!response.ok) {
    throw new Error(`runjobs ${what} download failed: ${response.status} ${url}`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}
