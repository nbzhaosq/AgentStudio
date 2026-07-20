import { randomUUID } from "node:crypto";
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
  readonly agents: AgentConfig[];
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
    // 同一触发消息不重复入队
    if (queue.some((t) => t.trigger.id === turn.trigger.id)) return;
    queue.push(turn);
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
    if (!reply.trim()) return;

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
      .map((a) => (a.id === agent.id ? null : `- @${a.id} (${a.name})`))
      .filter(Boolean)
      .join("\n");
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

    return `你是 ${agent.name}（@${agent.id}），正在一个多 Agent 协作聊天室里工作。
房间绑定的项目目录（你的工作目录）：${this.info.cwd}

参与者：
- user（人类用户）
${roster || "（暂无其他 agent）"}

规则：
1. 阅读下面的对话记录，回应 TRIGGER 中 @ 你的消息。
2. 需要别人行动时，在回复中 @对方（如 @${this.agents.find((a) => a.id !== agent.id)?.id ?? "名字"}）；@all 呼叫所有人。
3. 只有在确实需要对方行动时才 @ 人；否则不要在回复中使用 @，让对话自然结束。
4. 你可以直接读写项目目录里的文件来完成实际工作。
5. 回复聚焦、简洁，用中文（除非用户用其他语言）。

=== 对话记录（最新在后） ===
${transcript || "（暂无记录）"}

=== TRIGGER（需要你现在回应的消息） ===
[${trigger.kind === "user" ? "user" : `@${trigger.author}`}]: ${trigger.text}

现在轮到你发言。只输出你要发到聊天室里的内容，不要加任何前缀或解释。`;
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
