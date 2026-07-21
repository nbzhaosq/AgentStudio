import { useEffect, useRef, useState } from "react";
import type {
  AgentInfo,
  AgentStatus,
  ChatMessage,
  RoomInfo,
} from "@agent-studio/shared";
import Composer from "./Composer";
import Markdown from "./Markdown";

interface Props {
  room: RoomInfo;
  agents: AgentInfo[];
  messages: ChatMessage[];
  statuses: Record<string, AgentStatus>;
  activities: Record<string, string[]>;
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
  return {
    label: a ? `${a.name} (@${a.id})` : `@${m.author}`,
    color: a?.color ?? "#a1a1aa",
  };
}

/** 消息正文：agent 消息用 markdown 渲染；长消息默认折叠 */
function MessageBody({ msg, color, agents }: { msg: ChatMessage; color: string; agents: AgentInfo[] }) {
  const [open, setOpen] = useState(false);
  const text = msg.text;
  const isLong = text.length > 600 || text.includes("```");
  let shown = !isLong || open ? text : text.slice(0, 300);
  if (isLong && !open && (shown.match(/```/g)?.length ?? 0) % 2 === 1) {
    shown += "\n```";
  }
  return (
    <div className="break-words border-l-2 pl-3" style={{ borderColor: color }}>
      {msg.kind === "agent" ? (
        <Markdown text={shown} agents={agents} />
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
          {renderText(shown, agents)}
          {isLong && !open && "…"}
        </div>
      )}
      {isLong && (
        <button
          className="mt-1 rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "收起" : `展开全部（${text.length} 字）`}
        </button>
      )}
    </div>
  );
}

export default function ChatView({ room, agents, messages, statuses, activities, onSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, statuses]);

  const thinking = agents.filter((a) => statuses[a.id] === "thinking");

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="border-b border-white/6 px-6 py-3.5">
        <div className="font-display text-sm font-semibold tracking-wide text-zinc-100">
          {room.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
          <span className="truncate">{room.cwd}</span>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="3" fill="#22d3ee" opacity="0.9" />
              <circle cx="18" cy="8" r="3" fill="#34d399" opacity="0.85" />
              <circle cx="11" cy="18" r="3" fill="#facc15" opacity="0.85" />
              <path d="M8.5 7.5 15 8M7 9l3 6.5M16.5 10.5 12.5 15.5" stroke="#52525b" strokeWidth="1.2" />
            </svg>
            <p className="max-w-sm text-sm leading-relaxed text-zinc-500">
              还没有消息。用{" "}
              <span className="font-mono text-zinc-400">@名字</span> 呼叫 agent，或{" "}
              <span className="font-mono text-zinc-400">@all</span>{" "}
              全员集合，它们会在这个目录里真实读写文件、协同推进。
            </p>
          </div>
        )}
        {messages.map((m) => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className="msg-in flex justify-center">
                <span className="rounded-full border border-white/6 bg-white/3 px-3 py-1 font-mono text-[10px] text-zinc-500">
                  {m.text}
                </span>
              </div>
            );
          }
          const meta = authorMeta(m, agents);
          return (
            <div key={m.id} className="msg-in">
              <div className="mb-1 flex items-baseline gap-2">
                <span
                  className="font-display text-[13px] font-semibold"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </span>
                <span className="font-mono text-[10px] text-zinc-600">
                  {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <MessageBody msg={m} color={meta.color} agents={agents} />
            </div>
          );
        })}
        {thinking.map((a) => {
          const acts = activities[a.id] ?? [];
          const lastFile = acts.length > 0 ? acts[acts.length - 1] : null;
          return (
            <div key={a.id} className="msg-in flex items-center gap-2.5 text-sm">
              <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-display text-[13px]" style={{ color: a.color }}>
                {a.name}
              </span>
              <span className="text-zinc-500">正在工作…</span>
              {lastFile && (
                <span className="truncate font-mono text-[11px] text-emerald-400/80">
                  ✎ {lastFile}
                </span>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <Composer agents={agents} onSend={onSend} />
    </main>
  );
}
