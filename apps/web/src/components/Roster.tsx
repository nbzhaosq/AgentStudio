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
    <aside className="w-52 shrink-0 border-l border-zinc-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          成员（{agents.length}）
        </h2>
        {candidates.length > 0 && (
          <button
            className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            onClick={() => setPicking((v) => !v)}
          >
            {picking ? "取消" : "+ 添加"}
          </button>
        )}
      </div>

      {picking && (
        <div className="mb-3 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
          {candidates.map((a) => (
            <button
              key={a.id}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-zinc-800"
              onClick={() => {
                onAddAgent(a.id);
                setPicking(false);
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: a.color }}
              />
              @{a.id}
              <span className="truncate text-xs text-zinc-500">{a.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold">
            你
          </span>
          <span className="text-sm text-zinc-300">user</span>
        </div>
        {agents.map((a) => {
          const thinking = statuses[a.id] === "thinking";
          const acts = activities[a.id] ?? [];
          const lastFile = acts.length > 0 ? acts[acts.length - 1] : null;
          return (
            <div key={a.id} className="group flex items-center gap-2.5">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${thinking ? "animate-pulse" : ""}`}
                style={{ backgroundColor: a.color }}
              >
                {a.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-zinc-300">@{a.id}</div>
                <div className="text-[10px] text-zinc-600">
                  {thinking ? "工作中…" : "空闲"}
                </div>
                {thinking && lastFile && (
                  <div className="max-w-36 truncate font-mono text-[10px] text-emerald-500/80">
                    ✎ {lastFile}
                  </div>
                )}
                {a.instructions && (
                  <div className="mt-0.5 max-w-36 text-[10px] leading-snug text-zinc-500">
                    {a.instructions}
                  </div>
                )}
              </div>
              <button
                className="hidden shrink-0 rounded px-1 text-xs text-zinc-600 hover:bg-zinc-800 hover:text-red-400 group-hover:block"
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
        <div className="mt-5 border-t border-zinc-800 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              会话
            </h3>
            <button
              className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
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
                className="ml-auto hidden rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 group-hover:block"
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
