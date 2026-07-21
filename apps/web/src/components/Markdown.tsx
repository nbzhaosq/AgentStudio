import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentInfo } from "@agent-studio/shared";

/**
 * 把 @提及（房间内 agent）加粗，保持路由可辨识度。
 * 跳过代码块/行内代码内的内容。
 */
function boldMentions(text: string, agents: AgentInfo[]): string {
  const names = new Set(
    agents.flatMap((a) => [a.id.toLowerCase(), a.name.toLowerCase()]),
  );
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // 代码段原样保留
      return seg.replace(/@([A-Za-z0-9_-]+)/g, (m, name: string) =>
        names.has(name.toLowerCase()) || name.toLowerCase() === "all"
          ? `**${m}**`
          : m,
      );
    })
    .join("");
}

export default function Markdown({
  text,
  agents,
}: {
  text: string;
  agents: AgentInfo[];
}) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {boldMentions(text, agents)}
      </ReactMarkdown>
    </div>
  );
}
