import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentDef, ClientEvent, RoomInfo, ServerEvent } from "@agent-studio/shared";
import { configPath, loadAgents, serverRoot } from "./config.js";
import { invokeAgent } from "./adapter.js";
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
// 老库升级：种子里的会话续聊字段补到已存在但缺少这些字段的 agent 上（不覆盖用户其他设置）
if (existsSync(configPath)) {
  const seedById = new Map(loadAgents().map((a) => [a.id, a]));
  for (const a of store.listAgents()) {
    const seed = seedById.get(a.id);
    if (seed && !a.sessionResumeArgs && seed.sessionResumeArgs) {
      store.upsertAgent({
        ...a,
        sessionStartArgs: seed.sessionStartArgs,
        sessionResumeArgs: seed.sessionResumeArgs,
        sessionCapture: seed.sessionCapture,
      });
    }
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
      const info: RoomInfo = {
        id: randomUUID(),
        name: body.name.trim(),
        cwd: path.resolve(body.cwd),
        agentIds,
        createdAt: Date.now(),
      };
      store.saveRoom(info);
      const room = new Room(info, [], [], makeRoomDeps());
      room.syncAgents(store.listAgents());
      rooms.set(info.id, room);
      return json(res, 201, info);
    }
    const roomMatch = p.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch && req.method === "PATCH") {
      const room = rooms.get(roomMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      const body = JSON.parse(await readBody(req)) as { agentIds?: string[] };
      if (!Array.isArray(body.agentIds) || body.agentIds.length === 0) {
        return json(res, 400, { error: "agentIds 必须是非空数组" });
      }
      const all = store.listAgents();
      const validIds = body.agentIds.filter((id) => all.some((a) => a.id === id));
      if (validIds.length === 0) {
        return json(res, 400, { error: "agentIds 中没有有效 agent" });
      }
      const before = new Set(room.info.agentIds);
      const added = validIds.filter((id) => !before.has(id));
      room.setAgentIds(validIds, all);
      store.saveRoom(room.info);
      if (added.length > 0) {
        const names = added
          .map((id) => {
            const a = all.find((x) => x.id === id)!;
            return `${a.name} (@${a.id})`;
          })
          .join("、");
        room.postSystem(`📥 ${names} 加入了房间`);
      }
      broadcast({ type: "rooms_changed" });
      return json(res, 200, room.info);
    }
    const msgMatch = p.match(/^\/api\/rooms\/([^/]+)\/messages$/);
    if (msgMatch && req.method === "GET") {
      const room = rooms.get(msgMatch[1]);
      if (!room) return json(res, 404, { error: "房间不存在" });
      return json(res, 200, room.getMessages());
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
    }
  });
});

server.listen(PORT, () => {
  console.log(`Agent Studio server: http://localhost:${PORT}`);
  console.log(
    `已加载 agents: ${store.listAgents().map((a) => a.id).join(", ")}；房间数: ${rooms.size}`,
  );
});
