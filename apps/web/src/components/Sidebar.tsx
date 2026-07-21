import { useState } from "react";
import type { AgentInfo, RoomInfo } from "@agent-studio/shared";
import ThemeSwitcher from "./ThemeSwitcher";

interface Props {
  rooms: RoomInfo[];
  activeRoomId: string | null;
  agents: AgentInfo[];
  onSelect: (id: string) => void;
  onManageAgents: () => void;
  onCreated: (room: RoomInfo) => void;
}

function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="3" fill="#22d3ee" opacity="0.9" />
      <circle cx="18" cy="8" r="3" fill="#34d399" opacity="0.85" />
      <circle cx="11" cy="18" r="3" fill="#facc15" opacity="0.85" />
      <path d="M8.5 7.5 15 8M7 9l3 6.5M16.5 10.5 12.5 15.5" stroke="#71717a" strokeWidth="1.2" />
    </svg>
  );
}

export default function Sidebar({ rooms, activeRoomId, agents, onSelect, onManageAgents, onCreated }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const { api } = await import("../api");
      const room = await api.createRoom({ name, cwd, agentIds: selected });
      onCreated(room);
      setShowForm(false);
      setName("");
      setCwd("");
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel/60">
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2">
          <LogoMark />
          <h1 className="font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-text-1">
            Agent Studio
          </h1>
        </div>
        <ThemeSwitcher />
      </div>

      <div className="flex gap-1.5 px-3 pb-3">
        <button
          className="flex-1 rounded-lg border border-line bg-hover px-2 py-1.5 font-mono text-[11px] text-text-2 transition-colors hover:border-line2 hover:text-text-1"
          onClick={onManageAgents}
        >
          ⚙ Agents
        </button>
        <button
          className="flex-1 rounded-lg border border-signal/25 bg-signal/10 px-2 py-1.5 font-mono text-[11px] text-signal transition-colors hover:bg-signal/20"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "取消" : "+ 房间"}
        </button>
      </div>

      {showForm && (
        <div className="mx-3 mb-3 space-y-2 rounded-xl border border-line bg-panel2 p-3">
          <input
            className="field"
            placeholder="房间名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="field font-mono text-xs"
            placeholder="项目目录绝对路径"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {agents.map((a) => (
              <label
                key={a.id}
                className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  selected.includes(a.id)
                    ? "border-transparent text-white"
                    : "border-line2 text-text-3 hover:border-line2"
                }`}
                style={selected.includes(a.id) ? { backgroundColor: a.color } : {}}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={selected.includes(a.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
          </div>
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          <button
            className="w-full rounded-lg bg-signal/85 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-signal disabled:opacity-40"
            disabled={busy || !name.trim() || !cwd.trim() || selected.length === 0}
            onClick={() => void submit()}
          >
            创建房间
          </button>
        </div>
      )}

      <div className="micro-label px-4 pb-1.5">房间</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {rooms.map((r) => {
          const active = r.id === activeRoomId;
          const memberColors = agents
            .filter((a) => r.agentIds.includes(a.id))
            .map((a) => a.color);
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`group relative block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                active ? "bg-active" : "hover:bg-hover"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-signal" />
              )}
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm ${active ? "text-text-1" : "text-text-3"}`}>
                  {r.name}
                </span>
                <span className="flex shrink-0 -space-x-1">
                  {memberColors.slice(0, 5).map((c, i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full ring-2 ring-panel"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-text-4">{r.cwd}</div>
            </button>
          );
        })}
        {rooms.length === 0 && !showForm && (
          <p className="px-3 py-6 text-xs leading-relaxed text-text-4">
            还没有房间。
            <br />
            点上方「+ 房间」，把一群 agent 拉进同一个项目里干活。
          </p>
        )}
      </div>
    </aside>
  );
}
