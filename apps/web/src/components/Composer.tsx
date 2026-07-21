import { useRef, useState } from "react";
import { parseMentions, type AgentInfo } from "@agent-studio/shared";

interface Props {
  agents: AgentInfo[];
  onSend: (text: string) => void;
}

export default function Composer({ agents, onSend }: Props) {
  const [text, setText] = useState("");
  const [suggest, setSuggest] = useState<AgentInfo[]>([]);
  const [atStart, setAtStart] = useState(0);
  const [noMentionHint, setNoMentionHint] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updateSuggestions(value: string, caret: number) {
    const before = value.slice(0, caret);
    const m = before.match(/@([A-Za-z0-9_-]*)$/);
    if (!m) {
      setSuggest([]);
      return;
    }
    setAtStart(before.length - m[0].length);
    const token = m[1].toLowerCase();
    const matched = agents.filter(
      (a) =>
        a.id.toLowerCase().startsWith(token) ||
        a.name.toLowerCase().startsWith(token),
    );
    if ("all".startsWith(token)) {
      matched.unshift({ id: "all", name: "所有人", color: "#facc15" });
    }
    setSuggest(matched);
  }

  function pick(agent: AgentInfo) {
    const caret = taRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, atStart)}@${agent.id} ${text.slice(caret)}`;
    setText(next);
    setSuggest([]);
    taRef.current?.focus();
  }

  function send() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    if (agents.length > 0 && parseMentions(t, agents).length === 0) {
      setNoMentionHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setNoMentionHint(false), 4000);
    }
    setText("");
    setSuggest([]);
  }

  const canSend = text.trim().length > 0;

  return (
    <div className="relative px-5 pb-4">
      {noMentionHint && (
        <div className="absolute bottom-full left-5 mb-2 rounded-lg border border-amber-500/30 bg-amber-950/90 px-3 py-1.5 text-xs text-amber-300">
          这条消息没有 @ 任何 agent，不会触发他们回应。
        </div>
      )}
      {suggest.length > 0 && (
        <div className="absolute bottom-full left-5 mb-2 overflow-hidden rounded-xl border border-white/10 bg-ink-850 shadow-2xl shadow-black/50">
          {suggest.map((a) => (
            <button
              key={a.id}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/6"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: a.color }}
              />
              <span className="font-mono">@{a.id}</span>
              <span className="text-xs text-zinc-500">{a.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-xl border border-white/8 bg-ink-850 p-2 transition-colors focus-within:border-signal/35">
        <textarea
          ref={taRef}
          rows={2}
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-zinc-600"
          placeholder={`发消息… @ 呼叫 agent，@all 全员集合`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            updateSuggestions(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (suggest.length > 0) {
                pick(suggest[0]);
              } else {
                send();
              }
            } else if (e.key === "Tab" && suggest.length > 0) {
              e.preventDefault();
              pick(suggest[0]);
            } else if (e.key === "Escape") {
              setSuggest([]);
            }
          }}
        />
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[10px] text-zinc-600 sm:block">
            Enter ⏎
          </span>
          <button
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
              canSend
                ? "bg-signal text-ink-950 hover:bg-cyan-300"
                : "bg-white/6 text-zinc-600"
            }`}
            disabled={!canSend}
            onClick={send}
            title="发送"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3.4 20.4 21.85 12 3.4 3.6l-.01 6.53L14 12 3.39 13.87l.01 6.53z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
