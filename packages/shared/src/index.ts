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
  /**
   * 会话续聊（可选，三者共同构成能力声明）：
   * - sessionStartArgs：首轮调用模板（钉 id 型 CLI 用，含 {sessionId} 占位，由适配层生成 UUID）
   * - sessionResumeArgs：续聊调用模板（含 {sessionId} 占位）；缺省表示不支持续聊
   * - sessionCapture：从首轮输出中捕获 session id 的正则（捕获型 CLI 用，如 kimi/hermes/codex）
   */
  sessionStartArgs?: string[];
  sessionResumeArgs?: string[];
  sessionCapture?: string;
  /**
   * 流式输出（可选）：
   * - streamArgsExtra：流式模式下追加到调用参数末尾的 flags（如 claude 的 --output-format stream-json）
   * - streamFormat：输出流格式，缺省为 "text"（原样透传 stdout）
   */
  streamArgsExtra?: string[];
  streamFormat?: "claude-json" | "codex-json" | "kimi-json" | "text";
  /** 输出过滤：回复落库前按这些正则（gm）抹掉（如 hermes 的 session_id 行） */
  stripPatterns?: string[];
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
  /** 附图（相对房间工作目录的路径，如 .agent-studio/uploads/x.png） */
  images?: string[];
  /** 本轮调用的元信息（部分 CLI 可提供） */
  meta?: {
    costUsd?: number;
    durationMs?: number;
    tokens?: number;
  };
}

export interface RoomInfo {
  id: string;
  name: string;
  cwd: string;
  agentIds: string[];
  createdAt: number;
  /** 自驱讨论模式：安静时由主持人决定继续或结束话题 */
  autoDiscuss?: boolean;
  /** 主持人 agent id（autoDiscuss 启用时必填） */
  moderatorId?: string;
  /** 归档（侧栏折叠隐藏，不出现在默认列表） */
  archived?: boolean;
  /** git 工作流：每个 agent 的工作自动快照到 agent/<id> 分支 */
  gitWorkflow?: boolean;
  /** 房间级覆盖：@ 接力防环跳数（默认 12） */
  maxHops?: number;
  /** 房间级覆盖：自驱讨论每话题主持人续轮上限（默认 20） */
  maxAutoRounds?: number;
  /** 房间级覆盖：单次 agent 调用超时 ms（默认 600000） */
  timeoutMs?: number;
}

/** 任务卡（agent 通过 [task]/[doing]/[done] 标记管理） */
export interface Task {
  id: string;
  roomId: string;
  title: string;
  assignee: string | null;
  status: "todo" | "doing" | "done";
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type AgentStatus = "idle" | "thinking";

/** GET /api/rooms/:id/sessions 的返回行 */
export interface SessionInfo {
  agentId: string;
  name: string;
  color: string;
  sessionId: string;
  updatedAt: number;
}

/** WebSocket 客户端 → 服务端 */
export type ClientEvent =
  | { type: "send_message"; roomId: string; text: string; images?: string[] }
  | { type: "set_streaming"; roomId: string; streaming: boolean };

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
  | { type: "sessions_changed"; roomId: string }
  | { type: "tasks_changed"; roomId: string }
  | {
      /** 工作区文件变更活动（瞬态，不持久化）；agentId 为 null 表示多 agent 并发无法精确归属 */
      type: "agent_activity";
      roomId: string;
      agentId: string | null;
      paths: string[];
      ts: number;
    }
  | {
      /** agent 回复的流式草稿（瞬态）；text 为空字符串表示清除草稿 */
      type: "draft";
      roomId: string;
      agentId: string;
      text: string;
      ts: number;
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
