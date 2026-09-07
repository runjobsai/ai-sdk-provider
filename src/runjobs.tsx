import { createRunJobs, type RunJobsProvider } from "@runjobsai/ai-sdk-provider";
import type { BrowserUser, Model } from "@runjobsai/sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * One provider for the whole app.
 *
 * Every lab shares a single `createRunJobs()` instance, for the same
 * reason a real app would: under `authProvider: "runjobs"` each provider
 * owns a grant handshake and a token cache, so a second one means a
 * second sign-in. The labs below are all things you'd do with the model
 * this hands them — none of them build their own provider.
 */

export type AuthMode = "runjobs" | "static";

export interface ConnectSettings {
  authMode: AuthMode;
  apiKey: string;
  project: string;
  baseURL: string;
}

export interface EventLine {
  key: number;
  at: string;
  kind: "start" | "end" | "error";
  text: string;
}

interface RunJobsContextValue {
  settings: ConnectSettings;
  update: (patch: Partial<ConnectSettings>) => void;

  provider: RunJobsProvider | undefined;
  connect: () => void;
  connectError: string | undefined;

  user: BrowserUser | null;
  signIn: () => void;
  signOut: () => void;
  refreshUser: () => void;

  models: Model[];
  modelsLoading: boolean;
  modelsError: string | undefined;
  reloadModels: () => void;

  /** Chat model selected in the toolbar — what every lab runs against. */
  modelId: string;
  setModelId: (id: string) => void;

  events: EventLine[];
  clearEvents: () => void;
}

const RunJobsContext = createContext<RunJobsContextValue | undefined>(undefined);

const STORAGE_KEY = "runjobs-labs.settings";

const DEFAULT_SETTINGS: ConnectSettings = {
  authMode: "runjobs",
  apiKey: "",
  project: "",
  baseURL: "",
};

/** Settings survive the grant redirect, which navigates away and back. */
function loadSettings(): ConnectSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function RunJobsProviderScope({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ConnectSettings>(loadSettings);
  const [provider, setProvider] = useState<RunJobsProvider>();
  const [connectError, setConnectError] = useState<string>();
  const [user, setUser] = useState<BrowserUser | null>(null);

  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string>();
  const [modelId, setModelId] = useState("");

  const [events, setEvents] = useState<EventLine[]>([]);

  const update = useCallback((patch: Partial<ConnectSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private mode — the labs work fine, they just forget.
      }
      return next;
    });
  }, []);

  const connect = useCallback(() => {
    setConnectError(undefined);
    try {
      const isStatic = settings.authMode === "static";
      const project = settings.project.trim();
      const baseURL = settings.baseURL.trim();

      const created = createRunJobs({
        ...(isStatic
          ? { apiKey: settings.apiKey.trim() }
          : { authProvider: "runjobs" as const, ...(project && { project }) }),
        ...(baseURL && { baseURL }),
      });

      // The extra arrow is load-bearing. A provider IS a function —
      // `runjobs("Claude Sonnet 4.6")` is the shorthand for
      // `languageModel(...)` — and React reads a function passed to a
      // state setter as an updater. `setProvider(created)` would call
      // `created(previousState)` and store the *language model* it
      // returns, which has no `.events`, no `.client`, none of it.
      setProvider(() => created);
    } catch (err) {
      setProvider(undefined);
      setConnectError((err as Error).message);
    }
  }, [settings]);

  // The identity badge's own bus. Subscribing here is what proves AI SDK
  // traffic lands in it — the SDK emits these from the `fetch` the
  // provider hands to `@ai-sdk/openai-compatible`, not from `client.chat`.
  useEffect(() => {
    if (!provider) return;

    let key = 0;
    const push = (kind: EventLine["kind"], text: string) =>
      setEvents((prev) =>
        [{ key: key++, at: new Date().toISOString().slice(11, 23), kind, text }, ...prev].slice(0, 200),
      );

    const offs = [
      provider.events.on("request:start", (e) =>
        push("start", `▶ start   ${e.model} · ${e.capability}${e.streaming ? " · streaming" : ""}`),
      ),
      provider.events.on("request:end", (e) => {
        push(
          "end",
          `■ end     ${e.model} · ${e.latencyMs}ms · ${e.totalTokens} tok` +
            (e.costUSD !== undefined ? ` · $${e.costUSD.toFixed(6)}` : "") +
            (e.finishReason ? ` · ${e.finishReason}` : ""),
        );
        // A finished call is the cheapest moment to notice a sign-in that
        // happened underneath us — `provider.user` is a getter, so nothing
        // else would tell React it changed.
        setUser(provider.user);
      }),
      provider.events.on("request:error", (e) =>
        push("error", `✖ error   ${e.model} · ${e.statusCode ?? "—"} · ${e.error.message}`),
      ),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [provider]);

  const reloadModels = useCallback(() => {
    if (!provider) return;
    setModelsLoading(true);
    setModelsError(undefined);
    // Straight through the SDK client: `/v1/models` needs no auth, and
    // the AI SDK has no interface for a catalog.
    provider.client.models
      .list()
      .then((all) => {
        setModels(all);
        setModelId((current) => {
          if (current && all.some((m) => m.id === current)) return current;
          return all.find((m) => m.capability === "text" || m.capability === "vision")?.id ?? "";
        });
      })
      .catch((err: Error) => setModelsError(err.message))
      .finally(() => setModelsLoading(false));
  }, [provider]);

  // A fresh provider means a fresh catalog and a fresh identity read.
  useEffect(() => {
    if (!provider) return;
    setUser(provider.user);
    reloadModels();
  }, [provider, reloadModels]);

  const value = useMemo<RunJobsContextValue>(
    () => ({
      settings,
      update,
      provider,
      connect,
      connectError,
      user,
      signIn: () => provider?.signIn(),
      signOut: () => {
        provider?.signOut();
        setUser(null);
      },
      refreshUser: () => setUser(provider?.user ?? null),
      models,
      modelsLoading,
      modelsError,
      reloadModels,
      modelId,
      setModelId,
      events,
      clearEvents: () => setEvents([]),
    }),
    [
      settings,
      update,
      provider,
      connect,
      connectError,
      user,
      models,
      modelsLoading,
      modelsError,
      reloadModels,
      modelId,
      events,
    ],
  );

  return <RunJobsContext.Provider value={value}>{children}</RunJobsContext.Provider>;
}

export function useRunJobs(): RunJobsContextValue {
  const ctx = useContext(RunJobsContext);
  if (!ctx) throw new Error("useRunJobs must be used inside <RunJobsProviderScope>");
  return ctx;
}

/**
 * The selected chat model, or `undefined` when the app isn't connected.
 * Labs guard on this rather than reaching for the provider themselves.
 */
export function useChatModel() {
  const { provider, modelId } = useRunJobs();
  return useMemo(
    () => (provider && modelId ? provider(modelId) : undefined),
    [provider, modelId],
  );
}

/** Models filtered by capability — the embedding lab needs its own list. */
export function useModelsByCapability(...capabilities: string[]) {
  const { models } = useRunJobs();
  return useMemo(
    () => models.filter((m) => capabilities.includes(m.capability)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [models, capabilities.join(",")],
  );
}
