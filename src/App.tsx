import { Fragment, useEffect, useState } from "react";

import { highlightTsx } from "./highlight";
import { labs } from "./labs";
import { useRunJobs } from "./runjobs";
import { Panel } from "./ui";

export function App() {
  const [activeId, setActiveId] = useState(labs[0].id);
  const active = labs.find((l) => l.id === activeId) ?? labs[0];

  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="brand">@runjobsai/ai-sdk-provider</p>
        <p className="brand-sub">labs · ai-sdk.dev in the browser</p>
        <nav className="nav">
          {labs.map((lab, i) => (
            <button
              key={lab.id}
              aria-current={lab.id === active.id}
              onClick={() => setActiveId(lab.id)}
            >
              <span className="nav-num">{String(i + 1).padStart(2, "0")}</span>
              {lab.title}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <ConnectBar />

        <header className="lab-head">
          <h1>{active.title}</h1>
          <p>
            <Prose text={active.blurb} />
          </p>
          <div className="api-tags">
            {active.api.map((a) => (
              <code key={a}>{a}</code>
            ))}
          </div>
        </header>

        {/* Remount on lab change so each one starts from clean state.
            The prefixes matter: these are siblings, and two siblings
            sharing a key breaks React's reconciliation — the outgoing
            lab is never unmounted and every switch leaves another panel
            behind. */}
        <active.Demo key={`demo-${active.id}`} />

        <SourceView key={`source-${active.id}`} id={active.id} code={active.source} />

        <EventLog />
      </main>
    </div>
  );
}

/**
 * The lab's own file, highlighted. Nothing is highlighted until the
 * panel is opened: Shiki's grammar and themes are a separate chunk,
 * and most visits never expand this.
 */
function SourceView({ id, code }: { id: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string>();

  useEffect(() => {
    if (!open || html) return;
    let cancelled = false;
    highlightTsx(code).then(
      (result) => !cancelled && setHtml(result),
      // Highlighting is decorative — a failure falls back to plain text.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [open, code, html]);

  return (
    <details className="disclosure panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Source — src/labs/{id}.tsx</summary>
      {html ? (
        <div className="source" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="source">{code}</pre>
      )}
    </details>
  );
}

/** Renders `code` spans in the blurbs. Not a markdown parser. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((chunk, i) =>
        chunk.startsWith("`") && chunk.endsWith("`") ? (
          <code key={i}>{chunk.slice(1, -1)}</code>
        ) : (
          <Fragment key={i}>{chunk}</Fragment>
        ),
      )}
    </>
  );
}

function ConnectBar() {
  const {
    settings,
    update,
    provider,
    connect,
    connectError,
    user,
    signIn,
    signOut,
    models,
    modelId,
    setModelId,
    modelsLoading,
  } = useRunJobs();

  const isStatic = settings.authMode === "static";
  const chatModels = models.filter((m) => m.capability === "text" || m.capability === "vision");

  return (
    <Panel title="Connection">
      <div className="row wrap">
        <label>
          Auth
          <select
            value={settings.authMode}
            onChange={(e) => update({ authMode: e.target.value as typeof settings.authMode })}
          >
            <option value="runjobs">runjobs.ai sign-in (no API key)</option>
            <option value="static">API key</option>
          </select>
        </label>

        {isStatic ? (
          <label>
            API key
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder="rk_…"
              autoComplete="off"
            />
          </label>
        ) : (
          <label>
            Project <span className="hint">optional — pins the grant</span>
            <input
              value={settings.project}
              onChange={(e) => update({ project: e.target.value })}
              placeholder="proj_…"
              autoComplete="off"
            />
          </label>
        )}

        <label>
          Base URL <span className="hint">optional</span>
          <input
            value={settings.baseURL}
            onChange={(e) => update({ baseURL: e.target.value })}
            placeholder="https://www.runjobs.ai"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="row wrap">
        <button className="primary" onClick={connect}>
          {provider ? "Recreate provider" : "Create provider"}
        </button>
        <button onClick={signIn} disabled={!provider || isStatic}>
          Sign in
        </button>
        <button onClick={signOut} disabled={!provider || isStatic}>
          Sign out
        </button>

        <label style={{ flex: 1, minWidth: "220px" }}>
          Chat model <span className="hint">used by every lab</span>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={!provider}>
            {chatModels.length === 0 && <option value="">{modelsLoading ? "loading…" : "— none —"}</option>}
            {chatModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.capability === "vision" ? "  (vision)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {connectError && <div className="banner err">{connectError}</div>}
      <p className="empty-note">
        {!provider
          ? "No provider yet."
          : user
            ? `Signed in as ${user.name}.`
            : isStatic
              ? "Using an API key."
              : "Not signed in — the first call redirects to the grant page."}
      </p>
    </Panel>
  );
}

function EventLog() {
  const { events, clearEvents } = useRunJobs();

  return (
    <details className="disclosure panel" open>
      <summary>
        Events <span className="hint">the same bus the identity badge reads</span>
      </summary>
      <div className="row">
        <button onClick={clearEvents} disabled={events.length === 0}>
          Clear
        </button>
        <span className="status">{events.length} events</span>
      </div>
      <pre className="events">
        {events.length === 0
          ? "nothing yet — every AI SDK call through this provider shows up here"
          : events.map((e) => (
              <div key={e.key} className={`ev-${e.kind}`}>
                {e.at}  {e.text}
              </div>
            ))}
      </pre>
    </details>
  );
}
