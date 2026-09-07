import { useChat } from "@ai-sdk/react";
import {
  DirectChatTransport,
  ToolLoopAgent,
  getToolName,
  isTextUIPart,
  isToolUIPart,
  stepCountIs,
  tool,
  type DynamicToolUIPart,
  type LanguageModel,
  type ToolUIPart,
  type UITools,
} from "ai";
import { useMemo, useState } from "react";
import { z } from "zod";

import { useChatModel, useRunJobs } from "../runjobs";
import { NeedsModel, Panel, describeError } from "../ui";

export const meta = {
  id: "chat",
  title: "useChat — with no backend",
  blurb:
    "The one that normally needs a server. `useChat` talks to a transport, and the default one POSTs to /api/chat — but `DirectChatTransport` runs an Agent in-process instead, so the whole loop happens in this tab. That is the entire point of the provider: no API key to hide means no backend to hide it in. Tool calls execute here too — watch the weather tool resolve in the transcript.",
  api: ["useChat()", "DirectChatTransport", "ToolLoopAgent", "tool()"],
};

/** Executed in this page. The gateway can't do this for you — it's the
 *  reason to route through the AI SDK rather than call the API directly. */
const weather = tool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string().describe("City name") }),
  execute: async ({ city }) => {
    await new Promise((r) => setTimeout(r, 400)); // make the loop visible
    return { city, celsius: 22, conditions: "clear" };
  },
});

export default function ChatLab() {
  const model = useChatModel();
  const { modelId } = useRunJobs();
  const [toolsOn, setToolsOn] = useState(true);

  if (!model) return <NeedsModel>Connect and pick a chat model to run this.</NeedsModel>;

  return (
    <>
      <div className="row wrap">
        <label className="check">
          <input type="checkbox" checked={toolsOn} onChange={(e) => setToolsOn(e.target.checked)} />
          Local <code>weather</code> tool
        </label>
        <span className="hint">changing this restarts the conversation</span>
      </div>
      {/* Remounting on either change is the simplest correct way to swap
          agents: the Chat instance owns the transport for its lifetime. */}
      <Conversation key={`${modelId}:${toolsOn}`} model={model} toolsOn={toolsOn} />
    </>
  );
}

function Conversation({ model, toolsOn }: { model: LanguageModel; toolsOn: boolean }) {
  const transport = useMemo(() => {
    const agent = new ToolLoopAgent({
      model,
      instructions: "You are a concise assistant. Keep answers to a few sentences.",
      ...(toolsOn && { tools: { weather }, stopWhen: stepCountIs(5) }),
    });
    return new DirectChatTransport({ agent });
  }, [model, toolsOn]);

  const { messages, sendMessage, status, stop, error, clearError, regenerate } = useChat({ transport });
  const [input, setInput] = useState("");

  const busy = status === "submitted" || status === "streaming";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  return (
    <Panel>
      {messages.length === 0 ? (
        <p className="empty-note">
          Nothing yet. Try <em>“what's the weather in Shanghai?”</em> with the tool on.
        </p>
      ) : (
        <div className="chat">
          {messages.map((message) => (
            <div className={`msg ${message.role}`} key={message.id}>
              <span className="msg-role">{message.role}</span>
              {message.parts.map((part, i) => {
                if (isTextUIPart(part)) {
                  return part.text ? (
                    <div className="bubble" key={i}>
                      {part.text}
                    </div>
                  ) : null;
                }
                if (isToolUIPart(part)) return <ToolPart part={part} key={i} />;
                return null;
              })}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="banner err" style={{ marginTop: "0.9rem" }}>
          {describeError(error).text}{" "}
          <button onClick={clearError} style={{ marginLeft: "0.5rem" }}>
            dismiss
          </button>
        </div>
      )}

      <form className="row" onSubmit={submit} style={{ marginTop: "0.9rem" }}>
        <label style={{ flex: 1 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask something…"
            disabled={busy}
          />
        </label>
        <button className="primary" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
        <button type="button" onClick={stop} disabled={!busy}>
          Stop
        </button>
        <button type="button" onClick={() => regenerate()} disabled={busy || messages.length === 0}>
          Retry
        </button>
        <span className="status">{status}</span>
      </form>
    </Panel>
  );
}

function ToolPart({ part }: { part: ToolUIPart<UITools> | DynamicToolUIPart }) {
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;

  return (
    <div className="tool-part">
      <b>{getToolName(part)}()</b>
      <span className="tool-state">{part.state}</span>
      {input !== undefined && <div>← {JSON.stringify(input)}</div>}
      {output !== undefined && <div>→ {JSON.stringify(output)}</div>}
    </div>
  );
}
