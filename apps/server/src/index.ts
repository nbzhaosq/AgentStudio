import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentDef, ClientEvent, RoomInfo, ServerEvent } from "@agent-studio/shared";
import { configPath, loadAgents, serverRoot } from "./config.js";
import { invokeAgent } from "./adapter.js";
import { ensureGitRepo, branchStat } from "./git.js";
import { Room } from "./room.js";
import { Store } from "./store.js";

const PORT = Number(process.env.PORT ?? 8787);
const webDist = path.resolve(serverRoot, "../web/dist");

const store = new Store();
// 首次启动：agents 表为空且存在种子配置时导入
if (store.listAgents().length === 0 && existsSync(configPath)) {
  store.importAgents(loadAgents());
  console.log(`已从 ${configPath} 导入 agents 种子配置`);
}
// 老库升级：种子里新增的能力字段（会话续聊、流式）补到缺少它们的老 agent 上
if (existsSync(configPath)) {
  const seedById = new Map(loadAgents().map((a) => [a.id, a]));
  for (const a of store.listAgents()) {
    const seed = seedById.get(a.id);
    if (!seed) continue;
    const patch: Partial<AgentDef> = {};
    if (!a.sessionResumeArgs && seed.sessionResumeArgs) {
      patch.sessionStartArgs = seed.sessionStartArgs;
      patch.sessionResumeArgs = seed.sessionResumeArgs;
      patch.sessionCapture = seed.sessionCapture;
    }
    if (!a.streamFormat && !a.streamArgsExtra && (seed.streamFormat || seed.streamArgsExtra)) {
      patch.streamFormat = seed.streamFormat;
      patch.streamArgsExtra = seed.streamArgsExtra;
    }
    if (!a.stripPatterns && seed.stripPatterns) {
      patch.stripPatterns = seed.stripPatterns;
    }
    if (Object.keys(patch).length > 0) store.upsertAgent({ ...a, ...patch });
  }
}

const sockets = new Set<WebSocket>();
function broadcast(event: ServerEvent) {
  const data = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function makeRoomDeps() {
  return {
    invoke: invokeAgent,
    emit: broadcast,
    appendMessage: (m: Parameters<Store["appendMessage"]>[0]) =>
      store.appendMessage(m),
    saveSession: (roomId: string, agentId: string, sessionId: string) =>
      store.saveSession(roomId, agentId, sessionId),
    deleteSession: (roomId: string, agentId: string) =>
      store.deleteSession(roomId, agentId),
    createTask: (t: Parameters<Store["createTask"]>[0]) => store.createTask(t),
    updateTaskStatus: (roomId: string, ref: string, status: "todo" | "doing" | "done") =>
      store.updateTaskStatusByRef(roomId, ref, status),
  };
}

const rooms = new Map<string, Room>();
for (const info of store.loadRooms()) {
  const all = store.listAgents();
  const room = new Room(
    info,
    [],
    store.loadMessages(info.id),
    makeRoomDeps(),
    store.getSessions(info.id),
  );
  room.syncAgents(all);
  rooms.set(info.id, room);
}

/** agents 变更后：同步所有房间成员并通知客户端 */
function onAgentsChanged() {
  const all = store.listAgents();
  for (const room of rooms.values()) room.syncAgents(all);
  broadcast({ type: "agents_changed" });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(res: ServerResponse, urlPath: string): boolean {
  if (!existsSync(webDist)) return false;
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(webDist, safe);
  if (!file.startsWith(webDist)) return false;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(webDist, "index.html");
    if (!existsSync(file)) return false;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
  return true;
}

function validateAgent(body: Partial<AgentDef>): string | null {
  if (!body.id || !/^[a-z0-9][a-z0-9-]*$/.test(body.id)) {
    return "id 必填，且只能包含小写字母、数字、连字符";
  }
  if (!body.name?.trim()) return "name 必填";
  if (!body.cmd?.trim()) return "cmd 必填";
  if (!Array.isArray(body.args) || body.args.some((a) => typeof a !== "string")) {
    return "args 必须是字符串数组";
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    if (p === "/api/agents" && req.method === "GET") {
      return json(res, 200, store.listAgents());
    }
    if (p === "/api/agent-presets" && req.method === "GET") {
      // 内置 CLI 模板（来自种子配置），面板「从模板新建」用
      return json(res, 200, existsSync(configPath) ? loadAgents() : []);
    }
    if (p === "/api/agents" && req.method === "POST") {
      const body = (await readBody(req).then(JSON.parse)) as Partial<AgentDef>;
      const err = validateAgent(body);
      if (err) return json(res, 400, { error: err });
      const agent: AgentDef = {
        id: body.id!,
        name: body.name!.trim(),
        color: body.color || "#888888",
        cmd: body.cmd!.trim(),
        args: body.args!,
        instructions: body.instructions?.trim() || undefined,
        systemPrompt: body.systemPrompt?.trim() || undefined,
        sessionStartArgs: body.sessionStartArgs,
        sessionResumeArgs: body.sessionResumeArgs,
        sessionCapture: body.sessionCapture,
        streamArgsExtra: body.streamArgsExtra,
        streamFormat: body.streamFormat,
        stripPatterns: body.stripPatterns,
      };
      store.upsertAgent(agent);
      onAgentsChanged();
      return json(res, 200, agent);
    }
    const agentMatch = p.match(/^\/api\/agents\/([^/]+)$/);
    if (agentMatch && req.method === "DELETE") {
      const id = agentMatch[1];
      if (!store.getAgent(id)) return json(res, 404, { error: "agent 不存在" });
      store.deleteAgent(id);
      onAgentsChanged();
      return json(res, 200, { ok: true });
    }
    if (p === "/api/rooms" && req.method === "GET") {
      return json(res, 200, [...rooms.values()].map((r) => r.info));
    }
    if (p === "/api/rooms" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as {
        name?: string;
        cwd?: string;
        agentIds?: string[];
        gitWorkflow?: boolean;
      };
      if (!body.name?.trim()) return json(res, 400, { error: "缺少 name" });
      if (!body.cwd || !existsSync(body.cwd) || !statSync(body.cwd).isDirectory()) {
        return json(res, 400, { error: `目录不存在：${body.cwd}` });
      }
      const agentById = new Map(store.listAgents().map((a) => [a.id, a]));
      const agentIds = (body.agentIds ?? []).filter((id) => agentById.has(id));
      if (agentIds.length === 0) {
        return json(res, 400, { error: "至少选择一个有效 agent" });
      }
      const cwd = path.resolve(body.cwd);
      if (body.gitWorkflow && !ensureGitRepo(cwd)) {
        return json(res, 400, { error: "该目录无法初始化为 git 仓库" });
      }
      const info: RoomInfo = {
        id: randomUUID(),
        name: body.name.trim(),
        cwd,
        agentIds,
        createdAt: Date.now(),
        gitWorkflow: Boolean(body.gitWorkflow),
      };
      store.saveRoom(info);
      const room = new Room(info, [], [], makeRoomDeps());
      room.syncAgents(store.listAgents());
      rooms.set(info.id, room);
      return json(res, 201, info);
    }
    const roomMatch = p.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch && req.method === "DELETE") {
      const room = rooms.get(roomMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      rooms.delete(roomMatch[1]);
      store.deleteRoom(roomMatch[1]);
      broadcast({ type: "rooms_changed" });
      return json(res, 200, { ok: true });
    }
    if (roomMatch && req.method === "PATCH") {
      const room = rooms.get(roomMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      const body = JSON.parse(await readBody(req)) as {
        agentIds?: string[];
        autoDiscuss?: boolean;
        moderatorId?: string | null;
        archived?: boolean;
        gitWorkflow?: boolean;
      };
      const all = store.listAgents();
      // 成员变更（可选）
      if (body.agentIds !== undefined) {
        if (!Array.isArray(body.agentIds) || body.agentIds.length === 0) {
          return json(res, 400, { error: "agentIds 必须是非空数组" });
        }
        const validIds = body.agentIds.filter((id) => all.some((a) => a.id === id));
        if (validIds.length === 0) {
          return json(res, 400, { error: "agentIds 中没有有效 agent" });
        }
        const before = new Set(room.info.agentIds);
        const added = validIds.filter((id) => !before.has(id));
        const removed = [...before].filter((id) => !validIds.includes(id));
        room.setAgentIds(validIds, all);
        const nameOf = (id: string) => {
          const a = all.find((x) => x.id === id);
          return a ? `${a.name} (@${a.id})` : `@${id}`;
        };
        if (added.length > 0) {
          room.postSystem(`📥 ${added.map(nameOf).join("、")} 加入了房间`);
        }
        if (removed.length > 0) {
          for (const id of removed) room.clearSession(id); // 清掉被移除者的会话
          room.postSystem(`📤 ${removed.map(nameOf).join("、")} 离开了房间`);
          broadcast({ type: "sessions_changed", roomId: room.info.id });
        }
      }
      // 自驱讨论设置（可选）
      if (body.autoDiscuss !== undefined || body.moderatorId !== undefined) {
        const auto = body.autoDiscuss ?? room.info.autoDiscuss ?? false;
        const mod =
          body.moderatorId !== undefined
            ? (body.moderatorId ?? undefined)
            : room.info.moderatorId;
        if (auto && (!mod || !room.info.agentIds.includes(mod))) {
          return json(res, 400, { error: "开启自驱讨论需要指定房间内的主持人 agent" });
        }
        room.setAutoDiscuss(auto, mod);
      }
      // 归档（可选）
      if (body.archived !== undefined) {
        room.info.archived = body.archived;
      }
      // git 工作流（可选；开启时确保目录是 git 仓库）
      if (body.gitWorkflow !== undefined) {
        if (body.gitWorkflow && !ensureGitRepo(room.info.cwd)) {
          return json(res, 400, { error: "该目录无法初始化为 git 仓库" });
        }
        room.info.gitWorkflow = body.gitWorkflow;
      }
      store.saveRoom(room.info);
      broadcast({ type: "rooms_changed" });
      return json(res, 200, room.info);
    }
    const sessionsMatch = p.match(/^\/api\/rooms\/([^/]+)\/sessions(?:\/([^/]+))?$/);
    if (sessionsMatch && req.method === "GET" && !sessionsMatch[2]) {
      const room = rooms.get(sessionsMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      const agentById = new Map(store.listAgents().map((a) => [a.id, a]));
      const rows = store.getSessionRows(room.info.id).map((r) => ({
        ...r,
        name: agentById.get(r.agentId)?.name ?? r.agentId,
        color: agentById.get(r.agentId)?.color ?? "#888888",
      }));
      return json(res, 200, rows);
    }
    if (sessionsMatch && req.method === "DELETE") {
      const room = rooms.get(sessionsMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      if (sessionsMatch[2]) {
        room.clearSession(sessionsMatch[2]);
      } else {
        room.clearAllSessions();
        store.deleteRoomSessions(room.info.id);
      }
      broadcast({ type: "sessions_changed", roomId: room.info.id });
      return json(res, 200, { ok: true });
    }
    const msgMatch = p.match(/^\/api\/rooms\/([^/]+)\/messages$/);
    if (msgMatch && req.method === "GET") {
      const room = rooms.get(msgMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      return json(res, 200, room.getMessages());
    }
    const tasksMatch = p.match(/^\/api\/rooms\/([^/]+)\/tasks$/);
    if (tasksMatch && req.method === "GET") {
      const room = rooms.get(tasksMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      return json(res, 200, store.listTasks(room.info.id));
    }
    const branchesMatch = p.match(/^\/api\/rooms\/([^/]+)\/branches$/);
    if (branchesMatch && req.method === "GET") {
      const room = rooms.get(branchesMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      if (!room.info.gitWorkflow) return json(res, 200, []);
      const stats = room.info.agentIds
        .map((id) => branchStat(room.info.cwd, id))
        .filter((s): s is NonNullable<typeof s> => s !== null);
      return json(res, 200, stats);
    }
    if (p.startsWith("/api/")) {
      return json(res, 404, { error: "not found" });
    }
    if (req.method === "GET" && serveStatic(res, p)) return;
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  sockets.add(ws);
  ws.on("close", () => sockets.delete(ws));
  ws.on("message", async (raw) => {
    let event: ClientEvent;
    try {
      event = JSON.parse(String(raw)) as ClientEvent;
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "无法解析的消息" }));
      return;
    }
    if (event.type === "send_message") {
      const room = rooms.get(event.roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: "error", message: "房间不存在" }));
        return;
      }
      await room.postUserMessage(event.text);
    } else if (event.type === "set_streaming") {
      const room = rooms.get(event.roomId);
      room?.setStreaming(event.streaming);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Agent Studio server: http://localhost:${PORT}`);
  console.log(
    `已加载 agents: ${store.listAgents().map((a) => a.id).join(", ")}；房间数: ${rooms.size}`,
  );
});
