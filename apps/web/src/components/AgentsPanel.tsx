import { useState } from "react";
import type { AgentDef } from "@agent-studio/shared";
import { api } from "../api";

interface Props {
  agents: AgentDef[];
  onClose: () => void;
  onChanged: () => void;
}

const EMPTY: AgentDef = {
  id: "",
  name: "",
  color: "#888888",
  cmd: "",
  args: [],
  instructions: undefined,
};

export default function AgentsPanel({ agents, onClose, onChanged }: Props) {
  const [editing, setEditing] = useState<AgentDef | null>(null);
  const [argsText, setArgsText] = useState("[]");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = editing !== null && !agents.some((a) => a.id === editing.id);

  function startEdit(agent: AgentDef) {
    setEditing({ ...agent });
    setArgsText(JSON.stringify(agent.args, null, 2));
    setError("");
  }

  async function save() {
    if (!editing) return;
    let args: string[];
    try {
      args = JSON.parse(argsText) as string[];
      if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
        throw new Error();
      }
    } catch {
      setError("args 必须是 JSON 字符串数组");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.upsertAgent({ ...editing, args });
      onChanged();
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(`确定删除 agent「${id}」？已有房间将失去该成员。`)) return;
    await api.deleteAgent(id);
    onChanged();
    if (editing?.id === id) setEditing(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex h-[32rem] w-[46rem] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧列表 */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-zinc-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Agents
            </h2>
            <button
              className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
              onClick={() => startEdit(EMPTY)}
            >
              + 新增
            </button>
          </div>
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => startEdit(a)}
              className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-800 ${
                editing?.id === a.id ? "bg-zinc-800" : ""
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: a.color }}
              />
              <span className="truncate">@{a.id}</span>
            </button>
          ))}
        </div>

        {/* 右侧表单 */}
        <div className="flex-1 overflow-y-auto p-4">
          {editing ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">id（@ 用）</span>
                  <input
                    className="w-full rounded bg-zinc-950 px-2 py-1.5 font-mono outline-none ring-zinc-700 focus:ring-1 disabled:opacity-50"
                    value={editing.id}
                    disabled={!isNew}
                    onChange={(e) =>
                      setEditing({ ...editing, id: e.target.value.trim() })
                    }
                    placeholder="sea-code"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">显示名</span>
                  <input
                    className="w-full rounded bg-zinc-950 px-2 py-1.5 outline-none ring-zinc-700 focus:ring-1"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Sea Code"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">命令</span>
                  <input
                    className="w-full rounded bg-zinc-950 px-2 py-1.5 font-mono outline-none ring-zinc-700 focus:ring-1"
                    value={editing.cmd}
                    onChange={(e) => setEditing({ ...editing, cmd: e.target.value })}
                    placeholder="sea-code"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">颜色</span>
                  <input
                    type="color"
                    className="h-8 w-full cursor-pointer rounded bg-zinc-950"
                    value={editing.color}
                    onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">
                  args（JSON 数组，占位符：{"{prompt} {outfile} {cwd} {serverRoot}"}）
                </span>
                <textarea
                  rows={4}
                  className="w-full resize-none rounded bg-zinc-950 px-2 py-1.5 font-mono text-xs outline-none ring-zinc-700 focus:ring-1"
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">
                  专长设定（注入 prompt 并展示给其他 agent）
                </span>
                <input
                  className="w-full rounded bg-zinc-950 px-2 py-1.5 outline-none ring-zinc-700 focus:ring-1"
                  value={editing.instructions ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      instructions: e.target.value || undefined,
                    })
                  }
                  placeholder="前端与 UI 专家"
                />
              </label>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  className="rounded bg-blue-600 px-4 py-1.5 hover:bg-blue-500 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  保存
                </button>
                {!isNew && (
                  <button
                    className="rounded bg-red-900/60 px-4 py-1.5 text-red-300 hover:bg-red-900"
                    onClick={() => void remove(editing.id)}
                  >
                    删除
                  </button>
                )}
                <button
                  className="rounded bg-zinc-800 px-4 py-1.5 text-zinc-300 hover:bg-zinc-700"
                  onClick={() => setEditing(null)}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-600">
              选择左侧 agent 进行编辑，或点「+ 新增」
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
