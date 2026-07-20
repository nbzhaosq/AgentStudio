import { describe, expect, it } from "vitest";
import { parseMentions } from "@agent-studio/shared";

const agents = [
  { id: "claude", name: "Claude" },
  { id: "codex", name: "Codex" },
  { id: "mock-a", name: "MockA" },
];

describe("parseMentions", () => {
  it("按 id 匹配", () => {
    expect(parseMentions("@claude 你好", agents)).toEqual(["claude"]);
  });

  it("按 name 匹配，大小写不敏感", () => {
    expect(parseMentions("请 @CODEX 看一下", agents)).toEqual(["codex"]);
    expect(parseMentions("@mocka 在吗", agents)).toEqual(["mock-a"]);
  });

  it("多个 @ 去重且保持顺序", () => {
    expect(parseMentions("@codex @claude @codex", agents)).toEqual([
      "codex",
      "claude",
    ]);
  });

  it("@all 展开为全部", () => {
    expect(parseMentions("@all 开会", agents)).toEqual([
      "claude",
      "codex",
      "mock-a",
    ]);
  });

  it("未知名字不匹配", () => {
    expect(parseMentions("@nobody 你好", agents)).toEqual([]);
  });

  it("无 @ 返回空", () => {
    expect(parseMentions("普通消息", agents)).toEqual([]);
  });
});
