import { describe, expect, it } from "vitest";
import { buildArgs, captureSessionId } from "../src/adapter.js";

describe("buildArgs", () => {
  it("替换所有占位符", () => {
    expect(
      buildArgs(["-p", "{prompt}", "-r", "{sessionId}", "{cwd}"], {
        prompt: "你好",
        sessionId: "s1",
        cwd: "/x",
      }),
    ).toEqual(["-p", "你好", "-r", "s1", "/x"]);
  });

  it("无占位符时原样返回", () => {
    expect(buildArgs(["run", "exec"], {})).toEqual(["run", "exec"]);
  });
});

describe("captureSessionId", () => {
  it("kimi 输出格式", () => {
    expect(
      captureSessionId(
        "kimi -r (session_[a-z0-9-]+)",
        "...\nTo resume this session: kimi -r session_cf71c739-60bf-4e0e\n",
      ),
    ).toBe("session_cf71c739-60bf-4e0e");
  });

  it("codex --json thread_id 格式", () => {
    expect(
      captureSessionId(
        "\"thread_id\":\"([^\"]+)\"",
        '{"type":"thread.started","thread_id":"019f8507-fd5b-7630"}\n{"type":"turn.started"}',
      ),
    ).toBe("019f8507-fd5b-7630");
  });

  it("无 pattern 或不匹配返回 undefined", () => {
    expect(captureSessionId(undefined, "anything")).toBeUndefined();
    expect(captureSessionId("zzz", "abc")).toBeUndefined();
  });
});
