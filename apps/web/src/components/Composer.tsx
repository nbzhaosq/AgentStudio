import { useRef, useState } from "react";
import type { AgentInfo } from "@agent-studio/shared";

interface Props {
  agents: AgentInfo[];
  onSend: (text: string) => void;
}

export default function Composer({ agents, onSend }: Props) {
  const [text, setText] = useState("");
  const [suggest, setSuggest] = useState<AgentInfo[]>([]);
  const [atStart, setAtStart] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function updateSuggestions(value: string, caret: number) {
    const before = value.slice(0, caret);
    const m = before.match(/@([A-Za-z0-9_-]*)$/);
    if (!m) {
      setSuggest([]);
      return;
    }
    setAtStart(before.length - m[0].length);
    const token = m[1].toLowerCase();
    setSuggest(
      agents.filter(
        (a) =>
          a.id.toLowerCase().startsWith(token) ||
          a.name.toLowerCase().startsWith(token),
      ),
    );
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
    setText("");
    setSuggest([]);
  }

  return (
    <div className="relative border-t border-zinc-800 p-4">
      {suggest.length > 0 && (
        <div className="absolute bottom-full left-4 mb-1 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          {suggest.map((a) => (
            <button
              key={a.id}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-800"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: a.color }}
              />
              @{a.id}
              <span className="text-xs text-zinc-500">{a.name}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        rows={2}
        className="w-full resize-none rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-zinc-700 placeholder:text-zinc-600 focus:ring-1"
        placeholder="发消息… 用 @ 呼叫 agent，Enter 发送，Shift+Enter 换行"
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
    </div>
  );
}
