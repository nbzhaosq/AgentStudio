import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseMentions,
  type AgentStatus,
  type ChatMessage,
  type RoomInfo,
  type ServerEvent,
} from "@agent-studio/shared";
import type { AgentConfig } from "./config.js";

export type InvokeFn = (
  agent: AgentConfig,
  prompt: string,
  cwd: string,
) => Promise<string>;

export interface RoomDeps {
  invoke: InvokeFn;
  emit: (event: ServerEvent) => void;
  appendMessage: (msg: ChatMessage) => void;
  /** 一条用户消息引发的 @ 接力上限，默认 12 */
  maxHops?: number;
  /** prompt 中携带的最近消息条数，默认 30 */
  transcriptWindow?: number;
}

interface Turn {
  trigger: ChatMessage;
  chainId: string;
  hop: number;
}

const MAX_TEXT = 4000;

export class Room {
  readonly info: RoomInfo;
  agents: AgentConfig[];
  private deps: Required<Omit<RoomDeps, "maxHops" | "transcriptWindow">> & {
    maxHops: number;
    transcriptWindow: number;
  };
  private messages: ChatMessage[] = [];
  private queues = new Map<string, Turn[]>();
  private running = new Set<string>();

  constructor(
    info: RoomInfo,
    agents: AgentConfig[],
    history: ChatMessage[],
    deps: RoomDeps,
  ) {
    this.info = info;
    this.agents = agents;
    this.messages = history;
    this.deps = {
      invoke: deps.invoke,
      emit: deps.emit,
      appendMessage: deps.appendMessage,
      maxHops: deps.maxHops ?? 12,
      transcriptWindow: deps.transcriptWindow ?? 30,
    };
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  statusOf(agentId: string): AgentStatus {
    return this.running.has(agentId) ? "thinking" : "idle";
  }

  /** 测试用：所有回合队列已清空且没有正在执行的调用 */
  isSettled(): boolean {
    if (this.running.size > 0) return false;
    for (const q of this.queues.values()) if (q.length > 0) return false;
    return true;
  }

  /** agent 定义被编辑/删除后，按房间成员 id 重新同步 */
  syncAgents(all: AgentConfig[]) {
    this.agents = this.info.agentIds
      .map((id) => all.find((a) => a.id === id))
      .filter((a): a is AgentConfig => Boolean(a));
  }

  /** 更新房间成员（运行中热更新） */
  setAgentIds(ids: string[], all: AgentConfig[]) {
    this.info.agentIds = ids;
    this.syncAgents(all);
  }

  /** 落一条系统消息（广播 + 持久化 + 进入对话记录） */
  postSystem(text: string) {
    this.record("system", "system", text);
  }

  /** 用户发言：开启一条新触发链 */
  async postUserMessage(text: string): Promise<ChatMessage> {
    const msg = this.record("user", "user", text);
    const targets = this.resolveTargets(msg);
    for (const agentId of targets) {
      this.enqueue(agentId, { trigger: msg, chainId: msg.id, hop: 0 });
    }
    return msg;
  }

  private resolveTargets(msg: ChatMessage): string[] {
    const memberIds = this.agents.map((a) => a.id);
    return parseMentions(msg.text, this.agents).filter(
      (id) => id !== msg.author && memberIds.includes(id),
    );
  }

  private record(
    author: string,
    kind: ChatMessage["kind"],
    text: string,
  ): ChatMessage {
    const msg: ChatMessage = {
      id: randomUUID(),
      roomId: this.info.id,
      author,
      kind,
      text: text.slice(0, MAX_TEXT * 4),
      mentions: parseMentions(text, this.agents),
      ts: Date.now(),
    };
    this.messages.push(msg);
    this.deps.appendMessage(msg);
    this.deps.emit({ type: "message", message: msg });
    return msg;
  }

  private enqueue(agentId: string, turn: Turn) {
    const queue = this.queues.get(agentId) ?? [];
    if (queue.length > 0) {
      // 合并：每个 agent 最多保留一个待处理回合，新触发替换旧触发。
      // prompt 在回合开始时基于完整对话记录构建，不会丢失上下文；
      // hop 取较大值，保持防环计数保守。
      queue[0] = { trigger: turn.trigger, chainId: turn.chainId, hop: Math.max(queue[0].hop, turn.hop) };
    } else {
      queue.push(turn);
    }
    this.queues.set(agentId, queue);
    void this.pump(agentId);
  }

  private async pump(agentId: string) {
    if (this.running.has(agentId)) return;
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return;

    this.running.add(agentId);
    this.setStatus(agentId, "thinking");
    try {
      while (queue.length > 0) {
        const turn = queue.shift()!;
        await this.runTurn(agentId, turn);
      }
    } finally {
      this.running.delete(agentId);
      this.setStatus(agentId, "idle");
    }
  }

  private async runTurn(agentId: string, turn: Turn) {
    const agent = this.agents.find((a) => a.id === agentId);
    if (!agent) return;
    const prompt = this.buildPrompt(agent, turn.trigger);
    let reply: string;
    try {
      reply = await this.deps.invoke(agent, prompt, this.info.cwd);
    } catch (err) {
      this.record(
        "system",
        "system",
        `⚠️ ${agent.name} 调用失败：${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (!reply.trim() || /^\[skip\]/i.test(reply.trim())) return;

    const msg = this.record(agent.id, "agent", reply);
    const hop = turn.hop + 1;
    const targets = this.resolveTargets(msg);
    if (targets.length === 0) return;
    if (hop > this.deps.maxHops) {
      this.record(
        "system",
        "system",
        `🛑 触发链超过 ${this.deps.maxHops} 跳上限，已自动停止。`,
      );
      return;
    }
    for (const targetId of targets) {
      this.enqueue(targetId, { trigger: msg, chainId: turn.chainId, hop });
    }
  }

  private buildPrompt(agent: AgentConfig, trigger: ChatMessage): string {
    const roster = this.agents
      .map((a) => {
        if (a.id === agent.id) return null;
        const skill = a.instructions ? ` —— 专长：${a.instructions}` : "";
        return `- @${a.id} (${a.name})${skill}`;
      })
      .filter(Boolean)
      .join("\n");
    const role = agent.instructions
      ? `\n你的角色设定（房间管理员指定）：${agent.instructions}\n`
      : "";
    const custom = this.resolveSystemPrompt(agent);
    const customSection = custom
      ? `\n你的专属行为准则（由管理员配置，与其他规则冲突时以它为准）：\n${custom}\n`
      : "";
    const window = this.messages.slice(-this.deps.transcriptWindow);
    const transcript = window
      .map((m) => {
        const who =
          m.kind === "user" ? "user" : m.kind === "system" ? "system" : `@${m.author}`;
        const text =
          m.text.length > MAX_TEXT ? m.text.slice(0, MAX_TEXT) + "…(截断)" : m.text;
        return `[${who}]: ${text}`;
      })
      .join("\n\n");

    return `你是 ${agent.name}（@${agent.id}），正在一个多 Agent 协作聊天室里工作。${role}${customSection}
房间绑定的项目目录（你的工作目录）：${this.info.cwd}

参与者：
- user（人类用户）
${roster || "（暂无其他 agent）"}

规则：
1. 阅读下面的对话记录，回应 TRIGGER 中 @ 你的消息。
2. @ 是"呼叫对方行动"：只有确实需要对方做事或回应时才能 @。仅仅是提到某人时，写名字但不要加 @（例如写"codex 那边可以处理"，而不是"@codex 那边可以处理"）。@all 会呼叫所有人，仅在确有必要时用。
3. 如果 TRIGGER 只是顺带提到你、你没有实质内容要补充，只回复 [skip]（它不会被发到聊天室）。
4. 你可以直接读写项目目录里的文件来完成实际工作。
5. 简洁：寒暄一两句话带过；没有被明确要求时，不要长篇自我介绍。
6. 用中文回复（除非用户用其他语言）。

=== 对话记录（最新在后） ===
${transcript || "（暂无记录）"}

=== TRIGGER（需要你现在回应的消息） ===
[${trigger.kind === "user" ? "user" : `@${trigger.author}`}]: ${trigger.text}

现在轮到你发言。只输出你要发到聊天室里的内容，不要加任何前缀或解释。`;
  }

  /** 解析 agent 的专属 system prompt：@ 开头时读取文件（相对房间目录或绝对路径），否则按字面文本 */
  private resolveSystemPrompt(agent: AgentConfig): string {
    const sp = agent.systemPrompt?.trim();
    if (!sp) return "";
    if (sp.startsWith("@")) {
      const ref = sp.slice(1).trim();
      const file = path.isAbsolute(ref) ? ref : path.resolve(this.info.cwd, ref);
      try {
        return readFileSync(file, "utf8").trim();
      } catch {
        return ""; // 文件不存在时静默忽略，不阻断回合
      }
    }
    return sp;
  }

  private setStatus(agentId: string, status: AgentStatus) {
    this.deps.emit({
      type: "agent_status",
      roomId: this.info.id,
      agentId,
      status,
    });
  }
}
