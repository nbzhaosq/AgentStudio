import { useState } from "react";
import type { AgentInfo, AgentStatus } from "@agent-studio/shared";

interface Props {
  agents: AgentInfo[];
  statuses: Record<string, AgentStatus>;
  activities: Record<string, string[]>;
  candidates: AgentInfo[];
  onAddAgent: (agentId: string) => void;
}

export default function Roster({ agents, statuses, activities, candidates, onAddAgent }: Props) {
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
            <div key={a.id} className="flex items-center gap-2.5">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${thinking ? "animate-pulse" : ""}`}
                style={{ backgroundColor: a.color }}
              >
                {a.name.slice(0, 1)}
              </span>
              <div className="min-w-0">
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
            </div>
          );
        })}
      </div>
    </aside>
  );
}
