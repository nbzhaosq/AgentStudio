import { useEffect, useRef } from "react";
import type {
  AgentInfo,
  AgentStatus,
  ChatMessage,
  RoomInfo,
} from "@agent-studio/shared";
import Composer from "./Composer";

interface Props {
  room: RoomInfo;
  agents: AgentInfo[];
  messages: ChatMessage[];
  statuses: Record<string, AgentStatus>;
  onSend: (text: string) => void;
}

/** 把文本里的 @名字 高亮 */
function renderText(text: string, agents: AgentInfo[]) {
  const parts = text.split(/(@[A-Za-z0-9_-]+)/g);
  return parts.map((part, i) => {
    if (!part.startsWith("@")) return <span key={i}>{part}</span>;
    const token = part.slice(1).toLowerCase();
    const hit =
      token === "all"
        ? { color: "#facc15" }
        : agents.find(
            (a) =>
              a.id.toLowerCase() === token || a.name.toLowerCase() === token,
          );
    return hit ? (
      <span key={i} className="font-semibold" style={{ color: hit.color }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

function authorMeta(m: ChatMessage, agents: AgentInfo[]) {
  if (m.kind === "user") return { label: "你", color: "#e4e4e7" };
  if (m.kind === "system") return { label: "系统", color: "#71717a" };
  const a = agents.find((x) => x.id === m.author);
  return { label: a ? `${a.name} (@${a.id})` : `@${m.author}`, color: a?.color ?? "#a1a1aa" };
}

export default function ChatView({ room, agents, messages, statuses, onSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, statuses]);

  const thinking = agents.filter((a) => statuses[a.id] === "thinking");

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="border-b border-zinc-800 px-5 py-3">
        <div className="text-sm font-semibold">{room.name}</div>
        <div className="truncate font-mono text-xs text-zinc-500">{room.cwd}</div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <p className="pt-10 text-center text-sm text-zinc-600">
            还没有消息。在下方输入，用 @名字 呼叫 agent，比如 @
            {agents[0]?.id ?? "claude"} 或 @all。
          </p>
        )}
        {messages.map((m) => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className="text-center text-xs italic text-zinc-500">
                {m.text}
              </div>
            );
          }
          const meta = authorMeta(m, agents);
          return (
            <div key={m.id} className="group">
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="text-sm font-semibold" style={{ color: meta.color }}>
                  {meta.label}
                </span>
                <span className="text-[10px] text-zinc-600">
                  {new Date(m.ts).toLocaleTimeString()}
                </span>
              </div>
              <div
                className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm leading-relaxed text-zinc-200"
                style={{ borderColor: meta.color }}
              >
                {renderText(m.text, agents)}
              </div>
            </div>
          );
        })}
        {thinking.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm" style={{ color: a.color }}>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ backgroundColor: a.color }} />
            {a.name} 正在思考…
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <Composer agents={agents} onSend={onSend} />
    </main>
  );
}
