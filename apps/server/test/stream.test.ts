import { describe, expect, it } from "vitest";
import { makeStreamParser } from "../src/stream.js";

describe("makeStreamParser", () => {
  it("text：原样透传", () => {
    const p = makeStreamParser("text");
    expect(p.feed("hello ")).toBe("hello");
    expect(p.feed("world")).toBe("hello world");
    expect(p.final()).toBeNull();
  });

  it("claude-json：从 assistant/result 事件提取文本", () => {
    const p = makeStreamParser("claude-json");
    const lines = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"嗯"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"第一段"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"第二段"}]}}',
      '{"type":"result","result":"第一段\\n\\n第二段"}',
    ].join("\n") + "\n";
    p.feed(lines);
    expect(p.final()).toBe("第一段\n\n第二段");
  });

  it("claude-json：无 result 时拼接 text 块", () => {
    const p = makeStreamParser("claude-json");
    p.feed('{"type":"assistant","message":{"content":[{"type":"text","text":"只有块"}]}}\n');
    expect(p.final()).toBe("只有块");
  });

  it("codex-json：拼接 agent_message 段", () => {
    const p = makeStreamParser("codex-json");
    p.feed('{"type":"thread.started","thread_id":"t1"}\n');
    expect(p.feed('{"type":"item.completed","item":{"type":"agent_message","text":"部分一"}}\n')).toBe("部分一");
    expect(p.feed('{"type":"item.completed","item":{"type":"agent_message","text":"部分二"}}\n')).toBe("部分一\n\n部分二");
    expect(p.final()).toBe("部分一\n\n部分二");
  });

  it("kimi-json：取 assistant 内容并捕获 session_id", () => {
    const p = makeStreamParser("kimi-json");
    p.feed('{"role":"assistant","content":"完整回复"}\n');
    p.feed('{"role":"meta","type":"session.resume_hint","session_id":"session_abc-1"}\n');
    expect(p.final()).toBe("完整回复");
    expect(p.sessionId?.()).toBe("session_abc-1");
  });

  it("跨块拼接残行", () => {
    const p = makeStreamParser("claude-json");
    p.feed('{"type":"assistant","message":{"con');
    expect(p.feed('tent":[{"type":"text","text":"跨块"}]}}\n')).toBe("跨块");
  });

  it("claude-json：stream_event 增量文本", () => {
    const p = makeStreamParser("claude-json");
    p.feed('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}}\n');
    expect(p.feed('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}}\n')).toBe("你好");
    // 完整 assistant 事件到达后切到块模式
    expect(
      p.feed('{"type":"assistant","message":{"content":[{"type":"text","text":"你好！有什么可以帮你？"}]}}\n'),
    ).toBe("你好！有什么可以帮你？");
    expect(p.final()).toBe("你好！有什么可以帮你？");
  });
});
