import type { AgentInfo, AgentStatus } from "@agent-studio/shared";

interface Props {
  agents: AgentInfo[];
  statuses: Record<string, AgentStatus>;
}

export default function Roster({ agents, statuses }: Props) {
  return (
    <aside className="w-52 shrink-0 border-l border-zinc-800 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        成员（{agents.length}）
      </h2>
      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold">
            你
          </span>
          <span className="text-sm text-zinc-300">user</span>
        </div>
        {agents.map((a) => {
          const thinking = statuses[a.id] === "thinking";
          return (
            <div key={a.id} className="flex items-center gap-2.5">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${thinking ? "animate-pulse" : ""}`}
                style={{ backgroundColor: a.color }}
              >
                {a.name.slice(0, 1)}
              </span>
              <div>
                <div className="text-sm text-zinc-300">@{a.id}</div>
                <div className="text-[10px] text-zinc-600">
                  {thinking ? "思考中…" : "空闲"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
