import { useEffect, useState } from "react";
import type { AgentDef } from "@agent-studio/shared";
import { api } from "../api";

interface Props {
  agents: AgentDef[];
  onClose: () => void;
  onChanged: () => void;
}

const EMPTY: AgentDef = { id: "", name: "", color: "#22d3ee", cmd: "", args: [] };

const argsToLines = (args?: string[]) => (args ?? []).join("\n");
const linesToArgs = (text: string) =>
  text.split("\n").map((l) => l.trim()).filter(Boolean);

type Pane = "form" | "json" | "bulk";

export default function AgentsPanel({ agents, onClose, onChanged }: Props) {
  const [presets, setPresets] = useState<AgentDef[]>([]);
  const [editing, setEditing] = useState<AgentDef | null>(null);
  const [pane, setPane] = useState<Pane>("form");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [argsText, setArgsText] = useState("");
  const [startArgsText, setStartArgsText] = useState("");
  const [resumeArgsText, setResumeArgsText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = editing !== null && !agents.some((a) => a.id === editing.id);

  useEffect(() => {
    void fetch("/api/agent-presets")
      .then((r) => r.json())
      .then((p) => setPresets(p as AgentDef[]))
      .catch(() => {});
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 2000);
  }

  function fillForm(agent: AgentDef) {
    setArgsText(argsToLines(agent.args));
    setStartArgsText(argsToLines(agent.sessionStartArgs));
    setResumeArgsText(argsToLines(agent.sessionResumeArgs));
  }

  function formToAgent(): AgentDef | null {
    if (!editing) return null;
    return {
      ...editing,
      args: linesToArgs(argsText),
      sessionStartArgs: linesToArgs(startArgsText) || undefined,
      sessionResumeArgs: linesToArgs(resumeArgsText) || undefined,
    };
  }

  function startEdit(agent: AgentDef) {
    setEditing({ ...agent });
    fillForm(agent);
    setPane("form");
    setShowAdvanced(Boolean(agent.sessionResumeArgs));
    setError("");
  }

  function switchPane(next: Pane) {
    if (next === "json" && editing) {
      const a = formToAgent();
      setJsonText(JSON.stringify(a, null, 2));
    }
    if (next === "form" && pane === "json") {
      try {
        const a = JSON.parse(jsonText) as AgentDef;
        setEditing(a);
        fillForm(a);
      } catch {
        setError("JSON 无法解析，未切回表单");
        return;
      }
    }
    setError("");
    setPane(next);
  }

  async function save() {
    let agent: AgentDef | null;
    if (pane === "json") {
      try {
        agent = JSON.parse(jsonText) as AgentDef;
      } catch {
        setError("JSON 无法解析");
        return;
      }
    } else {
      agent = formToAgent();
    }
    if (!agent) return;
    setBusy(true);
    setError("");
    try {
      await api.upsertAgent(agent);
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

  async function importBulk() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bulkText);
    } catch {
      setError("JSON 无法解析");
      return;
    }
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { agents?: AgentDef[] }).agents;
    if (!Array.isArray(list) || list.length === 0) {
      setError("需要 agents 数组（与 agents.config.json 同格式）");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const a of list as AgentDef[]) await api.upsertAgent(a);
      onChanged();
      setPane("form");
      setEditing(null);
      flash(`已导入 ${list.length} 个 agent`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function exportAll() {
    const data = JSON.stringify({ agents }, null, 2);
    void navigator.clipboard.writeText(data).then(() => flash("已复制到剪贴板"));
  }

  const inputCls = "field";
  const labelCls = "mb-1 block text-[11px] text-text-3";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex h-[34rem] w-[50rem] overflow-hidden rounded-xl border border-line2 bg-panel2 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧列表 */}
        <div className="flex w-60 shrink-0 flex-col border-r border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="micro-label">Agents</h2>
            <div className="flex gap-1">
              <button
                className="rounded-md border border-line bg-hover px-1.5 py-0.5 text-[10px] text-text-2 hover:border-line2"
                title="导出全部为 agents.config.json 格式（复制到剪贴板）"
                onClick={exportAll}
              >
                导出
              </button>
              <button
                className="rounded-md border border-line bg-hover px-1.5 py-0.5 text-[10px] text-text-2 hover:border-line2"
                onClick={() => {
                  setBulkText(JSON.stringify({ agents: [presets[0] ?? EMPTY] }, null, 2));
                  setPane("bulk");
                  setEditing(null);
                  setError("");
                }}
              >
                导入
              </button>
              <button
                className="rounded-md border border-signal/25 bg-signal/10 px-1.5 py-0.5 text-[10px] text-signal hover:bg-signal/20"
                onClick={() => startEdit(EMPTY)}
              >
                + 新增
              </button>
            </div>
          </div>

          {presets.length > 0 && (
            <select
              className="field mb-2 text-xs"
              value=""
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (p) startEdit(p);
              }}
            >
              <option value="" disabled>
                从模板新建…
              </option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.cmd}）
                </option>
              ))}
            </select>
          )}

          <div className="flex-1 overflow-y-auto">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => startEdit(a)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-active ${
                  editing?.id === a.id ? "bg-active" : ""
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="truncate font-mono text-xs">@{a.id}</span>
                <span className="truncate text-[10px] text-text-4">{a.cmd}</span>
              </button>
            ))}
          </div>
          {notice && <div className="pt-2 text-center text-[11px] text-emerald-400">{notice}</div>}
        </div>

        {/* 右侧 */}
        <div className="flex-1 overflow-y-auto p-4">
          {pane === "bulk" ? (
            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-text-1">
                批量导入（与 agents.config.json 同格式）
              </h3>
              <textarea
                rows={16}
                className="field resize-none font-mono text-xs"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                spellCheck={false}
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  className="rounded-lg bg-signal/85 px-4 py-1.5 text-sm font-medium text-accent-fg hover:bg-signal disabled:opacity-40"
                  disabled={busy}
                  onClick={() => void importBulk()}
                >
                  导入（逐个覆盖同名 id）
                </button>
                <button
                  className="rounded-lg border border-line bg-hover px-4 py-1.5 text-sm text-text-2 hover:border-line2"
                  onClick={() => setPane("form")}
                >
                  取消
                </button>
              </div>
            </div>
          ) : editing ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-text-1">
                  {isNew ? "新建 agent" : `编辑 @${editing.id}`}
                </h3>
                <div className="flex overflow-hidden rounded-lg border border-line2">
                  {(["form", "json"] as const).map((m) => (
                    <button
                      key={m}
                      className={`px-3 py-1 font-mono text-[11px] transition-colors ${
                        pane === m ? "bg-signal/20 text-signal" : "text-text-3 hover:bg-hover"
                      }`}
                      onClick={() => switchPane(m)}
                    >
                      {m === "form" ? "表单" : "JSON"}
                    </button>
                  ))}
                </div>
              </div>

              {pane === "json" ? (
                <textarea
                  rows={18}
                  className="field resize-none font-mono text-xs"
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className={labelCls}>id（@ 用）</span>
                      <input
                        className={`${inputCls} font-mono disabled:opacity-50`}
                        value={editing.id}
                        disabled={!isNew}
                        onChange={(e) => setEditing({ ...editing, id: e.target.value.trim() })}
                        placeholder="sea-code"
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>显示名</span>
                      <input
                        className={inputCls}
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        placeholder="Sea Code"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className={labelCls}>命令</span>
                      <input
                        className={`${inputCls} font-mono`}
                        value={editing.cmd}
                        onChange={(e) => setEditing({ ...editing, cmd: e.target.value })}
                        placeholder="sea-code"
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>颜色</span>
                      <input
                        type="color"
                        className="h-8 w-full cursor-pointer rounded-lg border border-line bg-panel"
                        value={editing.color}
                        onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className={labelCls}>
                      参数（每行一个；占位符：{"{prompt} {outfile} {cwd} {serverRoot} {sessionId}"}）
                    </span>
                    <textarea
                      rows={4}
                      className={`${inputCls} resize-none font-mono text-xs`}
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                      placeholder={"-p\n{prompt}"}
                      spellCheck={false}
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>专长设定（展示给其他 agent）</span>
                    <input
                      className={inputCls}
                      value={editing.instructions ?? ""}
                      onChange={(e) =>
                        setEditing({ ...editing, instructions: e.target.value || undefined })
                      }
                      placeholder="前端与 UI 专家"
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>
                      专属 system prompt（@ 开头指向 md 文件，如 @AGENTS.frontend.md）
                    </span>
                    <textarea
                      rows={3}
                      className={`${inputCls} resize-none font-mono text-xs`}
                      value={editing.systemPrompt ?? ""}
                      onChange={(e) =>
                        setEditing({ ...editing, systemPrompt: e.target.value || undefined })
                      }
                      spellCheck={false}
                    />
                  </label>

                  <button
                    className="font-mono text-[11px] text-text-3 hover:text-text-2"
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? "▾" : "▸"} 会话续聊（高级）
                  </button>
                  {showAdvanced && (
                    <div className="space-y-3 rounded-lg border border-line p-3">
                      <label className="block">
                        <span className={labelCls}>sessionStartArgs（首轮，每行一个）</span>
                        <textarea
                          rows={2}
                          className={`${inputCls} resize-none font-mono text-xs`}
                          value={startArgsText}
                          onChange={(e) => setStartArgsText(e.target.value)}
                          spellCheck={false}
                        />
                      </label>
                      <label className="block">
                        <span className={labelCls}>sessionResumeArgs（续聊，每行一个）</span>
                        <textarea
                          rows={2}
                          className={`${inputCls} resize-none font-mono text-xs`}
                          value={resumeArgsText}
                          onChange={(e) => setResumeArgsText(e.target.value)}
                          spellCheck={false}
                        />
                      </label>
                      <label className="block">
                        <span className={labelCls}>sessionCapture（捕获 id 的正则，可选）</span>
                        <input
                          className={`${inputCls} font-mono text-xs`}
                          value={editing.sessionCapture ?? ""}
                          onChange={(e) =>
                            setEditing({ ...editing, sessionCapture: e.target.value || undefined })
                          }
                          placeholder="kimi -r (session_[a-z0-9-]+)"
                        />
                      </label>
                    </div>
                  )}
                </>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  className="rounded-lg bg-signal/85 px-4 py-1.5 font-medium text-accent-fg hover:bg-signal disabled:opacity-40"
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
                  className="rounded-lg border border-line bg-hover px-4 py-1.5 text-text-2 hover:border-line2"
                  onClick={() => setEditing(null)}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-4">
              选择左侧 agent 进行编辑，或从模板新建
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
