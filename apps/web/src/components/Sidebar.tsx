import { useState } from "react";
import type { AgentInfo, RoomInfo } from "@agent-studio/shared";

interface Props {
  rooms: RoomInfo[];
  activeRoomId: string | null;
  agents: AgentInfo[];
  onSelect: (id: string) => void;
  onManageAgents: () => void;
  onCreated: (room: RoomInfo) => void;
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
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-925">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-semibold tracking-wide text-zinc-300">
          Agent Studio
        </h1>
        <div className="flex gap-1.5">
          <button
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            title="管理 Agents"
            onClick={onManageAgents}
          >
            ⚙ Agents
          </button>
          <button
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "取消" : "+ 房间"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="space-y-2 border-b border-zinc-800 p-3 text-sm">
          <input
            className="w-full rounded bg-zinc-900 px-2 py-1.5 outline-none ring-zinc-700 placeholder:text-zinc-600 focus:ring-1"
            placeholder="房间名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full rounded bg-zinc-900 px-2 py-1.5 font-mono text-xs outline-none ring-zinc-700 placeholder:text-zinc-600 focus:ring-1"
            placeholder="项目目录绝对路径"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {agents.map((a) => (
              <label
                key={a.id}
                className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${
                  selected.includes(a.id)
                    ? "border-transparent text-white"
                    : "border-zinc-700 text-zinc-400"
                }`}
                style={
                  selected.includes(a.id) ? { backgroundColor: a.color } : {}
                }
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={selected.includes(a.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked
                        ? [...prev, a.id]
                        : prev.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            className="w-full rounded bg-blue-600 py-1.5 text-sm hover:bg-blue-500 disabled:opacity-50"
            disabled={busy || !name.trim() || !cwd.trim() || selected.length === 0}
            onClick={() => void submit()}
          >
            创建
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {rooms.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-900 ${
              r.id === activeRoomId ? "bg-zinc-900 text-zinc-100" : "text-zinc-400"
            }`}
          >
            <div className="truncate">{r.name}</div>
            <div className="truncate font-mono text-[10px] text-zinc-600">
              {r.cwd}
            </div>
          </button>
        ))}
        {rooms.length === 0 && !showForm && (
          <p className="px-4 py-6 text-xs text-zinc-600">
            还没有房间，点右上角「+ 房间」创建一个。
          </p>
        )}
      </div>
    </aside>
  );
}
