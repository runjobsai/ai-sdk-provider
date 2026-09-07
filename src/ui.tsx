import type { ProviderMetadata } from "ai";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

/**
 * What the gateway reports back about a call. The AI SDK has no field
 * for money, so it rides in `providerMetadata.runjobs` — anything a
 * provider puts there is passed through untouched.
 */
export interface RunJobsUsage {
  totalCost?: number;
  toolCosts?: { name: string; count: number; cost: number }[];
}

export function runjobsUsage(metadata: ProviderMetadata | undefined): RunJobsUsage | undefined {
  return metadata?.["runjobs"] as RunJobsUsage | undefined;
}

export function Usage({
  usage,
  tokens,
  steps,
  ms,
}: {
  usage?: RunJobsUsage | undefined;
  tokens?: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined;
  steps?: number | undefined;
  ms?: number | undefined;
}) {
  const bits: ReactNode[] = [];
  if (steps !== undefined) bits.push(<span key="s">steps <b>{steps}</b></span>);
  if (tokens) {
    bits.push(
      <span key="t">
        tokens <b>{tokens.inputTokens ?? "?"} in / {tokens.outputTokens ?? "?"} out</b>
      </span>,
    );
  }
  if (ms !== undefined) bits.push(<span key="ms">took <b>{ms}ms</b></span>);
  if (usage?.totalCost !== undefined) {
    bits.push(<span key="c">cost <b>${usage.totalCost.toFixed(6)}</b></span>);
  }
  for (const t of usage?.toolCosts ?? []) {
    bits.push(
      <span key={`tool-${t.name}`}>
        {t.name} ×{t.count} <b>${t.cost.toFixed(6)}</b>
      </span>,
    );
  }
  if (bits.length === 0) return null;
  return <div className="usage">{bits}</div>;
}

/* ------------------------------------------------------------------ */
/* Layout bits                                                         */
/* ------------------------------------------------------------------ */

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="panel">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function Output({ text, placeholder = "output appears here" }: { text: string; placeholder?: string }) {
  return <pre className={`output${text ? "" : " empty"}`}>{text || placeholder}</pre>;
}

export function Status({ text, kind = "" }: { text: string; kind?: "" | "ok" | "err" }) {
  if (!text) return null;
  return <span className={`status${kind ? ` ${kind}` : ""}`}>{text}</span>;
}

/** Every lab needs the same "you have to connect first" gate. */
export function NeedsModel({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>;
}

/**
 * Turns a thrown value into something worth showing. An aborted run is a
 * user action, not a failure, and the labs all say so the same way.
 */
export function describeError(err: unknown): { text: string; aborted: boolean } {
  const e = err as Error;
  if (e?.name === "AbortError") return { text: "stopped", aborted: true };
  return { text: `[${e?.name ?? "Error"}] ${e?.message ?? String(err)}`, aborted: false };
}
