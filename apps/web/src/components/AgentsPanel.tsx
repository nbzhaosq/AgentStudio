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
        className="flex h-[32rem] w-[46rem] overflow-hidden rounded-xl border border-white/10 bg-ink-850 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧列表 */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-white/6 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Agents
            </h2>
            <button
              className="rounded-md border border-white/8 bg-white/4 px-2 py-0.5 text-xs text-zinc-300 hover:border-white/20"
              onClick={() => startEdit(EMPTY)}
            >
              + 新增
            </button>
          </div>
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => startEdit(a)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/6 ${
                editing?.id === a.id ? "bg-white/8" : ""
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
                    className="field font-mono disabled:opacity-50"
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
                    className="field"
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
                    className="field font-mono"
                    value={editing.cmd}
                    onChange={(e) => setEditing({ ...editing, cmd: e.target.value })}
                    placeholder="sea-code"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">颜色</span>
                  <input
                    type="color"
                    className="h-8 w-full cursor-pointer rounded-lg border border-white/5 bg-ink-900"
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
                  className="field resize-none font-mono text-xs"
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
                  className="field"
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
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">
                  专属 system prompt（长文本；以 @ 开头则指向 md 文件，相对房间目录，如
                  @AGENTS.frontend.md）
                </span>
                <textarea
                  rows={4}
                  className="field resize-none font-mono text-xs"
                  value={editing.systemPrompt ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      systemPrompt: e.target.value || undefined,
                    })
                  }
                  placeholder={"例如：\n- 只负责前端，不改服务端代码\n- 组件用函数式 + hooks\n或：@AGENTS.frontend.md"}
                  spellCheck={false}
                />
              </label>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  className="rounded-lg bg-signal/85 px-4 py-1.5 font-medium text-ink-950 hover:bg-signal disabled:opacity-40"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  保存
                </button>
                {!isNew && (
                  <button
                    className="rounded-lg border border-red-500/30 bg-red-950/50 px-4 py-1.5 text-red-300 hover:bg-red-950"
                    onClick={() => void remove(editing.id)}
                  >
                    删除
                  </button>
                )}
                <button
                  className="rounded-lg border border-white/8 bg-white/4 px-4 py-1.5 text-zinc-300 hover:border-white/20"
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
