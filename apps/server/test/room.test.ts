import { describe, expect, it } from "vitest";
import type { ChatMessage, RoomInfo, ServerEvent } from "@agent-studio/shared";
import { Room, type InvokeFn } from "../src/room.js";
import type { AgentConfig } from "../src/config.js";

const agentA: AgentConfig = { id: "a", name: "AgentA", color: "#fff", cmd: "x", args: [] };
const agentB: AgentConfig = { id: "b", name: "AgentB", color: "#fff", cmd: "x", args: [] };

function makeRoom(
  replies: Record<string, string | ((prompt: string) => string)>,
  maxHops = 12,
) {
  const events: ServerEvent[] = [];
  const calls: string[] = [];
  const invoke: InvokeFn = async (agent, prompt) => {
    calls.push(agent.id);
    const r = replies[agent.id];
    return typeof r === "function" ? r(prompt) : (r ?? "ok");
  };
  const info: RoomInfo = {
    id: "room1",
    name: "test",
    cwd: "/tmp",
    agentIds: Object.keys(replies),
    createdAt: 0,
  };
  const agents = [agentA, agentB].filter((a) => info.agentIds.includes(a.id));
  const room = new Room(info, agents, [], {
    invoke,
    emit: (e) => events.push(e),
    appendMessage: () => {},
    maxHops,
  });
  return { room, events, calls };
}

async function waitSettled(room: Room, timeoutMs = 2000) {
  const start = Date.now();
  while (!room.isSettled()) {
    if (Date.now() - start > timeoutMs) throw new Error("room 未在超时内安定");
    await new Promise((r) => setTimeout(r, 5));
  }
  // 再等一拍，确保接力入队已发生
  await new Promise((r) => setTimeout(r, 10));
  while (!room.isSettled()) {
    if (Date.now() - start > timeoutMs) throw new Error("room 未在超时内安定");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("Room 路由", () => {
  it("用户 @a：只有 a 被调用；回复无 @ 则链结束", async () => {
    const { room, calls } = makeRoom({ a: "收到", b: "不应出现" });
    await room.postUserMessage("@a 看一下这个");
    await waitSettled(room);
    expect(calls).toEqual(["a"]);
    const msgs = room.getMessages();
    expect(msgs.filter((m) => m.kind === "agent")).toHaveLength(1);
    expect(msgs[1].author).toBe("a");
  });

  it("@all 触发所有成员", async () => {
    const { room, calls } = makeRoom({ a: "a ok", b: "b ok" });
    await room.postUserMessage("@all 集合");
    await waitSettled(room);
    expect(calls.sort()).toEqual(["a", "b"]);
  });

  it("接力：a 回复 @b → b 被触发；未被 @ 的不再触发", async () => {
    const { room, calls } = makeRoom({ a: "@b 接力一下", b: "搞定" });
    await room.postUserMessage("@a 开始");
    await waitSettled(room);
    expect(calls).toEqual(["a", "b"]);
  });

  it("agent @ 自己不会触发自己", async () => {
    const { room, calls } = makeRoom({ a: "@a 自言自语" });
    await room.postUserMessage("@a 开始");
    await waitSettled(room);
    expect(calls).toEqual(["a"]);
  });

  it("触发链超过 hop 上限后停止并给出系统消息", async () => {
    const { room, calls } = makeRoom(
      { a: "@b ping", b: "@a pong" },
      4,
    );
    await room.postUserMessage("@a 开始");
    await waitSettled(room);
    // a,b 交替，hop 每次 +1；上限 4 → 共触发 5 次调用后停止
    expect(calls.length).toBeLessThanOrEqual(6);
    const sys = room.getMessages().find((m) => m.kind === "system");
    expect(sys?.text).toContain("上限");
  });

  it("agent 调用失败时记录系统消息而不是崩溃", async () => {
    const events: ServerEvent[] = [];
    const info: RoomInfo = {
      id: "r",
      name: "t",
      cwd: "/tmp",
      agentIds: ["a"],
      createdAt: 0,
    };
    const room = new Room(info, [agentA], [], {
      invoke: async () => {
        throw new Error("boom");
      },
      emit: (e) => events.push(e),
      appendMessage: () => {},
    });
    await room.postUserMessage("@a 试一下");
    await waitSettled(room);
    const sys = room.getMessages().find((m) => m.kind === "system");
    expect(sys?.text).toContain("boom");
  });

  it("状态事件：thinking → idle", async () => {
    const { room, events } = makeRoom({ a: "done" });
    await room.postUserMessage("@a hi");
    await waitSettled(room);
    const statuses = events.filter((e) => e.type === "agent_status");
    expect(statuses[0]).toMatchObject({ agentId: "a", status: "thinking" });
    expect(statuses.at(-1)).toMatchObject({ agentId: "a", status: "idle" });
  });

  it("prompt 中包含触发消息文本", async () => {
    let seen = "";
    const info: RoomInfo = {
      id: "r",
      name: "t",
      cwd: "/tmp",
      agentIds: ["a"],
      createdAt: 0,
    };
    const room = new Room(info, [agentA], [], {
      invoke: async (_a, prompt) => {
        seen = prompt;
        return "ok";
      },
      emit: () => {},
      appendMessage: () => {},
    });
    await room.postUserMessage("@a 独特暗号-xyz");
    await waitSettled(room);
    expect(seen).toContain("独特暗号-xyz");
    expect(seen).toContain("TRIGGER");
  });

  it("回复 [skip] 时不落任何 agent 消息", async () => {
    const { room, calls } = makeRoom({ a: "[skip]" });
    await room.postUserMessage("@a 只是顺带提你一下");
    await waitSettled(room);
    expect(calls).toEqual(["a"]);
    expect(room.getMessages().filter((m) => m.kind === "agent")).toHaveLength(0);
  });

  it("instructions 注入自己的角色设定和同伴名册", async () => {
    let seen = "";
    const info: RoomInfo = {
      id: "r",
      name: "t",
      cwd: "/tmp",
      agentIds: ["a", "b"],
      createdAt: 0,
    };
    const aWithRole = { ...agentA, instructions: "前端与 UI 专家" };
    const bWithRole = { ...agentB, instructions: "后端与数据库专家" };
    const room = new Room(info, [aWithRole, bWithRole], [], {
      invoke: async (agent, prompt) => {
        if (agent.id === "a") seen = prompt;
        return "ok";
      },
      emit: () => {},
      appendMessage: () => {},
    });
    await room.postUserMessage("@a 做个页面");
    await waitSettled(room);
    expect(seen).toContain("前端与 UI 专家"); // 自己的角色
    expect(seen).toContain("@b (AgentB) —— 专长：后端与数据库专家"); // 名册里的同伴专长
  });

  it("文件活动归属到正在运行的 agent，并注入其他 agent 的 prompt", async () => {
    let aPrompt = "";
    const room = new Room(
      { id: "ra", name: "t", cwd: "/tmp", agentIds: ["a", "b"], createdAt: 0 },
      [agentA, agentB],
      [],
      {
        invoke: async (agent, prompt) => {
          if (agent.id === "a") {
            aPrompt = prompt;
            return "ok";
          }
          await new Promise((r) => setTimeout(r, 150)); // b 模拟慢任务
          return "done";
        },
        emit: () => {},
        appendMessage: () => {},
        activityFlushMs: 20,
      },
    );
    await room.postUserMessage("@b 开始干活");
    await new Promise((r) => setTimeout(r, 30)); // 等 b 进入 running
    room.handleFsChange("src/x.ts");
    await new Promise((r) => setTimeout(r, 60)); // 等 flush（20ms 周期）
    expect(room.recentFilesOf("b")).toContain("src/x.ts");
    // b 仍在运行时触发 a，a 的 prompt 应包含 b 的工作状态
    await room.postUserMessage("@a 看看情况");
    await waitSettled(room);
    expect(aPrompt).toContain("@b 正在工作");
    expect(aPrompt).toContain("src/x.ts");
  });

  it("会话续聊：第二轮带 sessionId 且 prompt 只含增量", async () => {
    const calls: { sessionId?: string; prompt: string }[] = [];
    const saved: string[][] = [];
    const info: RoomInfo = {
      id: "rs",
      name: "t",
      cwd: "/tmp",
      agentIds: ["a"],
      createdAt: 0,
    };
    const room = new Room(info, [agentA], [], {
      invoke: async (_a, prompt, _cwd, sessionId) => {
        calls.push({ sessionId, prompt });
        return { text: "ok", sessionId: "sess-1" };
      },
      emit: () => {},
      appendMessage: () => {},
      saveSession: (_r, a, s) => saved.push([a, s]),
    });
    await room.postUserMessage("@a 第一条");
    await waitSettled(room);
    await room.postUserMessage("@a 第二条");
    await waitSettled(room);

    expect(calls).toHaveLength(2);
    expect(calls[0].sessionId).toBeUndefined(); // 首轮无会话
    expect(calls[1].sessionId).toBe("sess-1"); // 第二轮续聊
    expect(calls[1].prompt).toContain("继续之前的协作");
    expect(calls[1].prompt).toContain("第二条");
    expect(calls[1].prompt).not.toContain("规则："); // 非全量 prompt
    expect(saved).toEqual([["a", "sess-1"], ["a", "sess-1"]]);
  });

  it("续聊失败自动降级为全量调用并重开会话", async () => {
    const prompts: string[] = [];
    let deleted = "";
    const saved: string[] = [];
    const info: RoomInfo = {
      id: "rs2",
      name: "t",
      cwd: "/tmp",
      agentIds: ["a"],
      createdAt: 0,
    };
    const room = new Room(
      info,
      [agentA],
      [],
      {
        invoke: async (_a, prompt, _cwd, sessionId) => {
          prompts.push(prompt);
          if (sessionId === "old-sess") throw new Error("session expired");
          return { text: "ok", sessionId: "new-sess" };
        },
        emit: () => {},
        appendMessage: () => {},
        saveSession: (_r, _a, s) => saved.push(s),
        deleteSession: (_r, a) => {
          deleted = a;
        },
      },
      { a: "old-sess" },
    );
    await room.postUserMessage("@a hi");
    await waitSettled(room);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("继续之前的协作"); // 先试续聊
    expect(prompts[1]).toContain("规则："); // 降级为全量
    expect(deleted).toBe("a"); // 旧会话已清
    expect(saved).toEqual(["new-sess"]); // 新会话已存
    expect(room.getMessages().some((m) => m.kind === "agent")).toBe(true);
  });

  it("运行中更新房间成员：新成员可被 @ 触发", async () => {
    const calls: string[] = [];
    const room = new Room(
      { id: "r2", name: "t", cwd: "/tmp", agentIds: ["a"], createdAt: 0 },
      [agentA],
      [],
      {
        invoke: async (agent) => (calls.push(agent.id), "ok"),
        emit: () => {},
        appendMessage: () => {},
      },
    );
    room.setAgentIds(["a", "b"], [agentA, agentB]);
    expect(room.agents.map((x) => x.id)).toEqual(["a", "b"]);
    await room.postUserMessage("@b 来干活");
    await waitSettled(room);
    expect(calls).toEqual(["b"]);
  });

  it("systemPrompt 字面文本注入 prompt", async () => {
    let seen = "";
    const info: RoomInfo = {
      id: "r",
      name: "t",
      cwd: "/tmp",
      agentIds: ["a"],
      createdAt: 0,
    };
    const aWithSp = { ...agentA, systemPrompt: "只写 TypeScript，不写测试以外的代码" };
    const room = new Room(info, [aWithSp], [], {
      invoke: async (_a, prompt) => {
        seen = prompt;
        return "ok";
      },
      emit: () => {},
      appendMessage: () => {},
    });
    await room.postUserMessage("@a hi");
    await waitSettled(room);
    expect(seen).toContain("只写 TypeScript，不写测试以外的代码");
    expect(seen).toContain("专属行为准则");
  });

  it("systemPrompt 以 @ 开头时读取文件内容", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const pathMod = await import("node:path");
    const dir = mkdtempSync(pathMod.join(tmpdir(), "agent-studio-sp-"));
    writeFileSync(pathMod.join(dir, "AGENTS.a.md"), "# 前端规范\n一律使用 Vue3。");

    let seen = "";
    const info: RoomInfo = {
      id: "r",
      name: "t",
      cwd: dir,
      agentIds: ["a"],
      createdAt: 0,
    };
    const aWithSp = { ...agentA, systemPrompt: "@AGENTS.a.md" };
    const room = new Room(info, [aWithSp], [], {
      invoke: async (_a, prompt) => {
        seen = prompt;
        return "ok";
      },
      emit: () => {},
      appendMessage: () => {},
    });
    await room.postUserMessage("@a hi");
    await waitSettled(room);
    expect(seen).toContain("一律使用 Vue3");
  });

  it("agent 忙碌期间的多个触发会合并为一个排队回合", async () => {
    let calls = 0;
    const info: RoomInfo = {
      id: "r",
      name: "t",
      cwd: "/tmp",
      agentIds: ["a"],
      createdAt: 0,
    };
    const room = new Room(info, [agentA], [], {
      invoke: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 30)); // 模拟慢 agent
        return "ok";
      },
      emit: () => {},
      appendMessage: () => {},
    });
    // 第一个触发立即开始执行；第 2、3 个触发在 agent 忙碌期间到达，应合并
    await room.postUserMessage("@a 第 1 条");
    await room.postUserMessage("@a 第 2 条");
    await room.postUserMessage("@a 第 3 条");
    await waitSettled(room);
    expect(calls).toBe(2);
  });
});
