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
});
