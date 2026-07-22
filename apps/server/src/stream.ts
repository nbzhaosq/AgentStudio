/**
 * 各家 CLI 流式输出的增量解析器。
 * feed() 接收 stdout 原始块，返回当前最佳草稿（全量替换式）；
 * final() 在进程结束时给出最终回复（无法解析时为 null，由调用方回退 stdout）。
 */
export type StreamFormat = "claude-json" | "codex-json" | "kimi-json" | "text";

export interface StreamParser {
  feed(chunk: string): string | null;
  final(): string | null;
  /** 从流中捕获到的会话 id（如 kimi 的 meta 事件） */
  sessionId?(): string | undefined;
  /** 调用元信息（部分格式可提供成本/耗时/token） */
  meta?(): { costUsd?: number; durationMs?: number; tokens?: number } | undefined;
}

function lineParser(
  onEvent: (ev: Record<string, unknown>) => void,
): { feedLines(chunk: string): void; flush(): void } {
  let buf = "";
  const handle = (line: string) => {
    line = line.trim();
    if (!line || !line.startsWith("{")) return;
    try {
      onEvent(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* 非 JSON 行忽略 */
    }
  };
  return {
    feedLines(chunk: string) {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    },
    flush() {
      handle(buf);
      buf = "";
    },
  };
}

export function makeStreamParser(format: StreamFormat): StreamParser {
  if (format === "text") {
    let acc = "";
    return {
      feed(chunk) {
        acc += chunk;
        return acc.trim();
      },
      final: () => null,
    };
  }

  if (format === "kimi-json") {
    let reply = "";
    let sid: string | undefined;
    const lp = lineParser((ev) => {
      if (ev.role === "assistant" && typeof ev.content === "string") {
        reply = ev.content;
      } else if (
        ev.role === "meta" &&
        typeof (ev as { session_id?: unknown }).session_id === "string"
      ) {
        sid = (ev as { session_id: string }).session_id;
      }
    });
    return {
      feed(chunk) {
        lp.feedLines(chunk);
        return reply || null;
      },
      final() {
        lp.flush();
        return reply || null;
      },
      sessionId: () => sid,
    };
  }

  if (format === "codex-json") {
    const segments: string[] = [];
    let tokens: number | undefined;
    const lp = lineParser((ev) => {
      const item = ev.item as { type?: string; text?: string } | undefined;
      if (ev.type === "item.completed" && item?.type === "agent_message" && item.text) {
        segments.push(item.text);
      }
      const usage = (ev as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      if (usage && typeof usage.input_tokens === "number") {
        tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
      }
    });
    return {
      feed(chunk) {
        lp.feedLines(chunk);
        return segments.length > 0 ? segments.join("\n\n") : null;
      },
      final() {
        lp.flush();
        return segments.length > 0 ? segments.join("\n\n") : null;
      },
      meta: () => (tokens !== undefined ? { tokens } : undefined),
    };
  }

  // claude-json：assistant 事件含 text 内容块；result 事件含最终文本；
  // 开启 --include-partial-messages 时另有 stream_event 增量
  const blocks: string[] = [];
  let current = "";
  let resultText = "";
  let costUsd: number | undefined;
  let durationMs: number | undefined;
  const lp = lineParser((ev) => {
    if (ev.type === "assistant") {
      const msg = ev.message as { content?: { type?: string; text?: string }[] };
      for (const c of msg?.content ?? []) {
        if (c.type === "text" && c.text) blocks.push(c.text);
      }
      current = ""; // 完整消息到达后增量重新计
    } else if (ev.type === "stream_event") {
      const e = ev.event as
        | { type?: string; delta?: { type?: string; text?: string } }
        | undefined;
      if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
        current += e.delta.text;
      } else if (e?.type === "message_stop") {
        current = "";
      }
    } else if (ev.type === "result" && typeof ev.result === "string") {
      resultText = ev.result;
      if (typeof ev.total_cost_usd === "number") costUsd = ev.total_cost_usd;
      if (typeof ev.duration_ms === "number") durationMs = ev.duration_ms;
    }
  });
  const draft = () => {
    const parts = current ? [...blocks, current] : blocks;
    return parts.length > 0 ? parts.join("\n\n") : null;
  };
  return {
    feed(chunk) {
      lp.feedLines(chunk);
      return draft();
    },
    final() {
      lp.flush();
      return resultText || draft();
    },
    meta: () =>
      costUsd !== undefined || durationMs !== undefined
        ? { costUsd, durationMs }
        : undefined,
  };
}
