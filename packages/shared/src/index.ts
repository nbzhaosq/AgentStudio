/** 房间内的 Agent 定义（来自 agents.config.json） */
export interface AgentInfo {
  id: string;
  name: string;
  color: string;
  /** 角色/专长设定，注入 prompt 并展示给其他 agent */
  instructions?: string;
}

/** 房间内可选的 Agent 完整定义（含调用方式） */
export interface AgentDef extends AgentInfo {
  cmd: string;
  args: string[];
  /** 专属 system prompt；以 @ 开头时视为文件路径（相对房间目录或绝对路径），每轮读取其内容 */
  systemPrompt?: string;
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
  | { type: "agents_changed" }
  | { type: "rooms_changed" }
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
