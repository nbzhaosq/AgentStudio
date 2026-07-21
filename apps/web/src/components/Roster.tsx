import { useState } from "react";
import type { AgentInfo, AgentStatus, SessionInfo } from "@agent-studio/shared";

interface Props {
  agents: AgentInfo[];
  statuses: Record<string, AgentStatus>;
  activities: Record<string, string[]>;
  candidates: AgentInfo[];
  onAddAgent: (agentId: string) => void;
  onRemoveAgent: (agentId: string) => void;
  sessions: SessionInfo[];
  onResetSession: (agentId?: string) => void;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export default function Roster({ agents, statuses, activities, candidates, onAddAgent, onRemoveAgent, sessions, onResetSession }: Props) {
  const [picking, setPicking] = useState(false);

  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-l border-white/6 bg-ink-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="micro-label">成员 · {agents.length}</h2>
        {candidates.length > 0 && (
          <button
            className="rounded-md border border-white/8 bg-white/4 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
            onClick={() => setPicking((v) => !v)}
          >
            {picking ? "取消" : "+ 添加"}
          </button>
        )}
      </div>

      {picking && (
        <div className="mb-3 overflow-hidden rounded-xl border border-white/10 bg-ink-850 shadow-xl shadow-black/40">
          {candidates.map((a) => (
            <button
              key={a.id}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/6"
              onClick={() => {
                onAddAgent(a.id);
                setPicking(false);
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: a.color }}
              />
              <span className="font-mono text-xs">@{a.id}</span>
              <span className="truncate text-xs text-zinc-500">{a.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold text-zinc-200">
            你
          </span>
          <span className="text-sm text-zinc-300">user</span>
        </div>
        {agents.map((a) => {
          const thinking = statuses[a.id] === "thinking";
          const acts = activities[a.id] ?? [];
          const lastFile = acts.length > 0 ? acts[acts.length - 1] : null;
          return (
            <div key={a.id} className="group flex items-start gap-2.5">
              <span className="relative shrink-0">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full font-display text-xs font-bold text-white"
                  style={{ backgroundColor: a.color, boxShadow: `0 0 0 2px ${a.color}33` }}
                >
                  {a.name.slice(0, 1)}
                </span>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-ink-900 ${
                    thinking ? "pulse-dot bg-emerald-400" : "bg-zinc-600"
                  }`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-zinc-300">@{a.id}</div>
                <div className="text-[10px] text-zinc-600">
                  {thinking ? "工作中…" : "空闲"}
                </div>
                {thinking && lastFile && (
                  <div className="max-w-40 truncate font-mono text-[10px] text-emerald-400/80">
                    ✎ {lastFile}
                  </div>
                )}
                {a.instructions && (
                  <div className="mt-0.5 max-w-40 text-[10px] leading-snug text-zinc-500">
                    {a.instructions}
                  </div>
                )}
              </div>
              <button
                className="hidden shrink-0 rounded px-1 text-xs text-zinc-600 transition-colors hover:bg-white/8 hover:text-red-400 group-hover:block"
                title="移出房间"
                onClick={() => {
                  if (confirm(`把 ${a.name} (@${a.id}) 移出房间？其会话也会被清除。`)) {
                    onRemoveAgent(a.id);
                  }
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {sessions.length > 0 && (
        <div className="mt-5 border-t border-white/6 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="micro-label">会话</h3>
            <button
              className="rounded-md border border-white/8 bg-white/4 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
              title="清除所有 agent 的 CLI 会话，下一轮重新开局"
              onClick={() => {
                if (confirm("重开所有 agent 的会话？它们将丢失此前的对话记忆。")) {
                  onResetSession();
                }
              }}
            >
              全部重开
            </button>
          </div>
          {sessions.map((s) => (
            <div key={s.agentId} className="group mb-1.5 flex items-center gap-1.5 text-[11px]">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate font-mono text-zinc-400" title={s.sessionId}>
                {s.sessionId.slice(0, 12)}…
              </span>
              <span className="shrink-0 text-zinc-600">{timeAgo(s.updatedAt)}</span>
              <button
                className="ml-auto hidden rounded px-1 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200 group-hover:block"
                title="重开该 agent 的会话"
                onClick={() => onResetSession(s.agentId)}
              >
                ↺
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
