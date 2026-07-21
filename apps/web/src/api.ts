import type {
  AgentDef,
  ChatMessage,
  RoomInfo,
  ServerEvent,
  SessionInfo,
} from "@agent-studio/shared";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `请求失败 ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  agents: () => req<AgentDef[]>("/api/agents"),
  upsertAgent: (agent: AgentDef) =>
    req<AgentDef>("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agent),
    }),
  deleteAgent: (id: string) =>
    req<{ ok: boolean }>(`/api/agents/${id}`, { method: "DELETE" }),
  rooms: () => req<RoomInfo[]>("/api/rooms"),
  createRoom: (input: { name: string; cwd: string; agentIds: string[] }) =>
    req<RoomInfo>("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  updateRoomAgents: (roomId: string, agentIds: string[]) =>
    req<RoomInfo>(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds }),
    }),
  roomSessions: (roomId: string) =>
    req<SessionInfo[]>(`/api/rooms/${roomId}/sessions`),
  deleteRoomSession: (roomId: string, agentId?: string) =>
    req<{ ok: boolean }>(
      `/api/rooms/${roomId}/sessions${agentId ? `/${agentId}` : ""}`,
      { method: "DELETE" },
    ),
  messages: (roomId: string) =>
    req<ChatMessage[]>(`/api/rooms/${roomId}/messages`),
};

export function connectWS(onEvent: (e: ServerEvent) => void): WebSocket {
  const url = new URL("/ws", location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url);
  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(String(ev.data)) as ServerEvent);
    } catch {
      /* 忽略坏帧 */
    }
  };
  ws.onclose = () => {
    setTimeout(() => connectWS(onEvent), 1500);
  };
  return ws;
}
