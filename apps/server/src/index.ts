import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientEvent, RoomInfo, ServerEvent } from "@agent-studio/shared";
import { loadAgents, serverRoot, type AgentConfig } from "./config.js";
import { invokeAgent } from "./adapter.js";
import { Room } from "./room.js";
import { Store } from "./store.js";

const PORT = Number(process.env.PORT ?? 8787);
const webDist = path.resolve(serverRoot, "../web/dist");

const store = new Store();
const allAgents = loadAgents();
const agentById = new Map(allAgents.map((a) => [a.id, a]));

const sockets = new Set<WebSocket>();
function broadcast(event: ServerEvent) {
  const data = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

const rooms = new Map<string, Room>();
for (const info of store.loadRooms()) {
  const agents = info.agentIds
    .map((id) => agentById.get(id))
    .filter((a): a is AgentConfig => Boolean(a));
  rooms.set(
    info.id,
    new Room(info, agents, store.loadMessages(info.id), {
      invoke: invokeAgent,
      emit: broadcast,
      appendMessage: (m) => store.appendMessage(m),
    }),
  );
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    if (p === "/api/agents" && req.method === "GET") {
      return json(
        res,
        200,
        allAgents.map(({ id, name, color }) => ({ id, name, color })),
      );
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
      const agents = agentIds.map((id) => agentById.get(id)!);
      rooms.set(
        info.id,
        new Room(info, agents, [], {
          invoke: invokeAgent,
          emit: broadcast,
          appendMessage: (m) => store.appendMessage(m),
        }),
      );
      return json(res, 201, info);
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
    `已加载 agents: ${allAgents.map((a) => a.id).join(", ")}；房间数: ${rooms.size}`,
  );
});
