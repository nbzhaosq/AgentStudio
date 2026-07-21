import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentDef, ChatMessage, RoomInfo } from "@agent-studio/shared";
import { Store } from "../src/store.js";

function tmpStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-studio-store-"));
  return { dir, store: new Store(dir) };
}

const agent: AgentDef = {
  id: "test-a",
  name: "TestA",
  color: "#ff0000",
  cmd: "echo",
  args: ["{prompt}"],
  instructions: "测试 agent",
};

describe("Store (SQLite)", () => {
  it("agent upsert / list / get / delete", () => {
    const { store } = tmpStore();
    store.upsertAgent({
      ...agent,
      systemPrompt: "@AGENTS.test.md",
      sessionResumeArgs: ["-p", "{prompt}", "-r", "{sessionId}"],
      sessionCapture: "sid:(\\w+)",
    });
    const saved = store.getAgent("test-a");
    expect(saved).toMatchObject({ id: "test-a", cmd: "echo" });
    expect(saved?.systemPrompt).toBe("@AGENTS.test.md");
    expect(saved?.sessionResumeArgs).toEqual(["-p", "{prompt}", "-r", "{sessionId}"]);
    expect(saved?.sessionCapture).toBe("sid:(\\w+)");

    store.upsertAgent({ ...agent, name: "Renamed", args: ["a", "b"] });
    const got = store.getAgent("test-a");
    expect(got?.name).toBe("Renamed");
    expect(got?.args).toEqual(["a", "b"]);
    expect(got?.instructions).toBe("测试 agent");

    store.deleteAgent("test-a");
    expect(store.listAgents()).toHaveLength(0);
  });

  it("room 与 message 的存取", () => {
    const { store } = tmpStore();
    const room: RoomInfo = {
      id: "r1",
      name: "房间",
      cwd: "/tmp",
      agentIds: ["a", "b"],
      createdAt: 123,
    };
    store.saveRoom(room);
    expect(store.loadRooms()).toEqual([room]);

    const msg: ChatMessage = {
      id: "m1",
      roomId: "r1",
      author: "user",
      kind: "user",
      text: "你好 @a",
      mentions: ["a"],
      ts: 456,
    };
    store.appendMessage(msg);
    expect(store.loadMessages("r1")).toEqual([msg]);
    expect(store.loadMessages("别的房间")).toEqual([]);
  });

  it("room sessions 的存取删", () => {
    const { store } = tmpStore();
    expect(store.getSessions("r1")).toEqual({});
    store.saveSession("r1", "a", "sess-1");
    store.saveSession("r1", "b", "sess-2");
    store.saveSession("r1", "a", "sess-1b"); // 覆盖
    expect(store.getSessions("r1")).toEqual({ a: "sess-1b", b: "sess-2" });
    store.deleteSession("r1", "a");
    expect(store.getSessions("r1")).toEqual({ b: "sess-2" });
    expect(store.getSessions("别的房间")).toEqual({});
  });

  it("旧 JSONL 数据自动迁移", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agent-studio-legacy-"));
    mkdirSync(path.join(dir, "rooms"), { recursive: true });
    const room: RoomInfo = {
      id: "old-r",
      name: "旧房间",
      cwd: "/tmp",
      agentIds: ["a"],
      createdAt: 1,
    };
    writeFileSync(path.join(dir, "rooms.json"), JSON.stringify([room]));
    const msg: ChatMessage = {
      id: "old-m",
      roomId: "old-r",
      author: "user",
      kind: "user",
      text: "旧消息",
      mentions: [],
      ts: 2,
    };
    writeFileSync(
      path.join(dir, "rooms", "old-r.jsonl"),
      JSON.stringify(msg) + "\n",
    );

    const store = new Store(dir);
    expect(store.loadRooms()).toEqual([room]);
    expect(store.loadMessages("old-r")).toEqual([msg]);
  });
});
