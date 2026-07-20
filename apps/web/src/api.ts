import type {
  AgentInfo,
  ChatMessage,
  RoomInfo,
  ServerEvent,
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
  agents: () => req<AgentInfo[]>("/api/agents"),
  rooms: () => req<RoomInfo[]>("/api/rooms"),
  createRoom: (input: { name: string; cwd: string; agentIds: string[] }) =>
    req<RoomInfo>("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
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
