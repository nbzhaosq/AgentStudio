/** 房间内的 Agent 定义（来自 agents.config.json） */
export interface AgentInfo {
  id: string;
  name: string;
  color: string;
}

export type MessageKind = "user" | "agent" | "system";

export interface ChatMessage {
  id: string;
  roomId: string;
  /** 'user' 或 agent id 或 'system' */
  author: string;
  kind: MessageKind;
  text: string;
  /** 被 @ 的 agent id 列表（'all' 已展开） */
  mentions: string[];
  ts: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  cwd: string;
  agentIds: string[];
  createdAt: number;
}

export type AgentStatus = "idle" | "thinking";

/** WebSocket 客户端 → 服务端 */
export type ClientEvent = { type: "send_message"; roomId: string; text: string };

/** WebSocket 服务端 → 客户端 */
export type ServerEvent =
  | { type: "message"; message: ChatMessage }
  | {
      type: "agent_status";
      roomId: string;
      agentId: string;
      status: AgentStatus;
    }
  | { type: "error"; roomId?: string; message: string };

/**
 * 从文本中解析 @提及，返回匹配的 agent id 列表（去重、保持出现顺序）。
 * `@all` 展开为全部候选。匹配 id 或 name，大小写不敏感。
 */
export function parseMentions(
  text: string,
  candidates: Pick<AgentInfo, "id" | "name">[],
): string[] {
  const found: string[] = [];
  const re = /@([A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].toLowerCase();
    if (token === "all" || token === "everyone") {
      for (const c of candidates) {
        if (!found.includes(c.id)) found.push(c.id);
      }
      continue;
    }
    const hit = candidates.find(
      (c) => c.id.toLowerCase() === token || c.name.toLowerCase() === token,
    );
    if (hit && !found.includes(hit.id)) found.push(hit.id);
  }
  return found;
}
