import { randomUUID } from "node:crypto";
import { readFileSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import {
  parseMentions,
  type AgentStatus,
  type ChatMessage,
  type RoomInfo,
  type ServerEvent,
} from "@agent-studio/shared";
import type { AgentConfig } from "./config.js";

export type InvokeReply = string | { text: string; sessionId?: string };

export type InvokeFn = (
  agent: AgentConfig,
  prompt: string,
  cwd: string,
  sessionId?: string,
  onChunk?: (draft: string) => void,
) => Promise<InvokeReply>;

export interface RoomDeps {
  invoke: InvokeFn;
  emit: (event: ServerEvent) => void;
  appendMessage: (msg: ChatMessage) => void;
  /** 会话续聊持久化（可选，缺省不存） */
  saveSession?: (roomId: string, agentId: string, sessionId: string) => void;
  deleteSession?: (roomId: string, agentId: string) => void;
  /** 一条用户消息引发的 @ 接力上限，默认 12 */
  maxHops?: number;
  /** prompt 中携带的最近消息条数，默认 30 */
  transcriptWindow?: number;
  /** 文件活动聚合周期 ms，默认 800 */
  activityFlushMs?: number;
  /** 自驱讨论：每个话题主持人续轮上限，默认 20 */
  maxAutoRounds?: number;
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
  private deps: Required<Omit<RoomDeps, "maxHops" | "transcriptWindow" | "activityFlushMs" | "maxAutoRounds">> & {
    maxHops: number;
    transcriptWindow: number;
    activityFlushMs: number;
    maxAutoRounds: number;
  };
  private messages: ChatMessage[] = [];
  private queues = new Map<string, Turn[]>();
  private running = new Set<string>();
  /** agentId → CLI 会话 id（续聊用） */
  private sessions: Map<string, string>;
  /** agentId → 上次发言时间戳（增量 prompt 截取用） */
  private lastTurnAt = new Map<string, number>();
  /** 流式输出开关（运行时，随 set_streaming 切换） */
  private streaming = true;
  /** 自驱讨论：当前话题主持人已续轮数（用户发言时重置） */
  private autoRounds = 0;
  private watcher?: FSWatcher;
  /** agentId → 最近改动文件（最新在后，上限 10） */
  private recentFiles = new Map<string, string[]>();
  private pendingPaths = new Set<string>();
  private flushTimer?: NodeJS.Timeout;

  constructor(
    info: RoomInfo,
    agents: AgentConfig[],
    history: ChatMessage[],
    deps: RoomDeps,
    sessions?: Record<string, string>,
  ) {
    this.info = info;
    this.agents = agents;
    this.messages = history;
    this.sessions = new Map(Object.entries(sessions ?? {}));
    for (const m of history) {
      if (m.kind === "agent") this.lastTurnAt.set(m.author, m.ts);
    }
    this.deps = {
      invoke: deps.invoke,
      emit: deps.emit,
      appendMessage: deps.appendMessage,
      saveSession: deps.saveSession ?? (() => {}),
      deleteSession: deps.deleteSession ?? (() => {}),
      maxHops: deps.maxHops ?? 12,
      transcriptWindow: deps.transcriptWindow ?? 30,
      activityFlushMs: deps.activityFlushMs ?? 800,
      maxAutoRounds: deps.maxAutoRounds ?? 20,
    };
    // 监听工作区文件变更，作为 agent 的工作活动信号（平台不支持时静默降级）
    try {
      this.watcher = watch(this.info.cwd, { recursive: true }, (_e, filename) => {
        if (filename) this.handleFsChange(filename);
      });
      this.watcher.unref?.();
    } catch {
      /* 降级：无活动信号 */
    }
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

  /** 清除某 agent 的 CLI 会话（下一轮重新开局） */
  clearSession(agentId: string) {
    this.sessions.delete(agentId);
    this.deps.deleteSession(this.info.id, agentId);
  }

  /** 清除全房间的 CLI 会话 */
  clearAllSessions() {
    this.sessions.clear();
    for (const a of this.agents) this.deps.deleteSession(this.info.id, a.id);
  }

  setStreaming(on: boolean) {
    this.streaming = on;
  }

  /** 开关自驱讨论 / 更换主持人 */
  setAutoDiscuss(on: boolean, moderatorId?: string) {
    this.info.autoDiscuss = on;
    this.info.moderatorId = moderatorId;
  }

  /** 某 agent 最近改动的文件（测试与 prompt 用） */
  recentFilesOf(agentId: string): string[] {
    return this.recentFiles.get(agentId) ?? [];
  }

  /** 内部：工作区文件变更回调（聚合同一周期内的路径） */
  handleFsChange(filename: string) {
    const rel = filename.replaceAll("\\", "/");
    if (
      rel.includes("node_modules/") ||
      rel.includes(".git/") ||
      rel.startsWith(".git")
    ) {
      return;
    }
    this.pendingPaths.add(rel);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushActivity(), this.deps.activityFlushMs);
      this.flushTimer.unref?.();
    }
  }

  private flushActivity() {
    this.flushTimer = undefined;
    const paths = [...this.pendingPaths].slice(-5);
    this.pendingPaths.clear();
    if (paths.length === 0) return;
    // 同一时刻只有一个 agent 在运行时才能精确归属
    const running = [...this.running];
    const agentId = running.length === 1 ? running[0] : null;
    if (agentId) {
      const list = this.recentFiles.get(agentId) ?? [];
      for (const p of paths) {
        const i = list.indexOf(p);
        if (i >= 0) list.splice(i, 1);
        list.push(p);
      }
      this.recentFiles.set(agentId, list.slice(-10));
    }
    this.deps.emit({
      type: "agent_activity",
      roomId: this.info.id,
      agentId,
      paths,
      ts: Date.now(),
    });
  }

  /** 用户发言：开启一条新触发链，同时重置自驱讨论轮次（视为新话题/接管） */
  async postUserMessage(text: string): Promise<ChatMessage> {
    this.autoRounds = 0;
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
    if (kind === "agent") this.lastTurnAt.set(author, msg.ts);
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
    this.recentFiles.delete(agentId); // 新一轮工作，清空上次的改动记录
    this.setStatus(agentId, "thinking");
    try {
      while (queue.length > 0) {
        const turn = queue.shift()!;
        await this.runTurn(agentId, turn);
      }
    } finally {
      this.running.delete(agentId);
      this.setStatus(agentId, "idle");
      this.maybeAutonomous();
    }
  }

  /** 自驱讨论：安静时刻让主持人判断继续或结束（房间维度开关） */
  private maybeAutonomous() {
    if (!this.info.autoDiscuss || !this.info.moderatorId) return;
    if (!this.isSettled()) return;
    const mod = this.agents.find((a) => a.id === this.info.moderatorId);
    if (!mod) return;
    const last = this.messages.at(-1);
    if (!last || last.kind !== "agent") return;
    if (last.author === mod.id) {
      // 主持人说完无人接话 → 话题自然终止
      this.postSystem("🏁 讨论自然结束");
      return;
    }
    if (this.autoRounds >= this.deps.maxAutoRounds) {
      this.autoRounds++; // 上限提示只发一次
      this.postSystem(
        `🛑 自驱讨论已达 ${this.deps.maxAutoRounds} 轮上限，自动结束。用户发言可开启新话题。`,
      );
      return;
    }
    this.autoRounds++;
    void this.runModeratorTurn(mod);
  }

  private async runModeratorTurn(mod: AgentConfig) {
    this.running.add(mod.id);
    this.setStatus(mod.id, "thinking");
    const sessionId = this.sessions.get(mod.id);
    try {
      const window = this.messages.slice(-15);
      const transcript = window
        .map((m) => {
          const who =
            m.kind === "user" ? "user" : m.kind === "system" ? "system" : `@${m.author}`;
          const text =
            m.text.length > MAX_TEXT ? m.text.slice(0, MAX_TEXT) + "…(截断)" : m.text;
          return `[${who}]: ${text}`;
        })
        .join("\n\n");
      const roster = this.agents
        .filter((a) => a.id !== mod.id)
        .map((a) => `@${a.id}`)
        .join("、");
      const prompt = `你是本房间的主持人 ${mod.name}（@${mod.id}）。一个话题的讨论刚刚暂停，由你判断继续还是结束。
房间目录：${this.info.cwd}
参与者：user、${roster}

规则：
1. 若讨论已有明确结论，或继续下去没有增量价值：只回复 [end]。
2. 若值得继续：用一两句话小结进展与分歧，提出下一个最具体的问题，并 @ 应该回答的 agent（不要 @ 自己，不要 @all）。
3. 回复就是发到聊天室里的内容，不要加前缀或解释。

=== 最近讨论记录（最新在后） ===
${transcript}

现在轮到你裁决。`;

      let result: { text: string; sessionId?: string };
      try {
        result = await this.call(mod, prompt, sessionId);
      } catch (err) {
        if (!sessionId) throw err;
        console.warn(
          `[room ${this.info.id}] 主持人 @${mod.id} 续聊失败，降级:`,
          err instanceof Error ? err.message : err,
        );
        this.sessions.delete(mod.id);
        this.deps.deleteSession(this.info.id, mod.id);
        result = await this.call(mod, prompt);
      }
      if (result.sessionId) {
        this.sessions.set(mod.id, result.sessionId);
        this.deps.saveSession(this.info.id, mod.id, result.sessionId);
        this.deps.emit({ type: "sessions_changed", roomId: this.info.id });
      }

      const reply = result.text.trim();
      if (!reply || /^\[end\]/i.test(reply) || /^\[skip\]/i.test(reply)) {
        this.postSystem(`🏁 主持人 ${mod.name} 结束了本话题`);
        return;
      }
      const msg = this.record(mod.id, "agent", reply);
      for (const targetId of this.resolveTargets(msg)) {
        this.enqueue(targetId, { trigger: msg, chainId: `auto-${msg.id}`, hop: 0 });
      }
    } catch (err) {
      this.fail(mod, err);
    } finally {
      this.running.delete(mod.id);
      this.setStatus(mod.id, "idle");
      this.maybeAutonomous();
    }
  }

  private async runTurn(agentId: string, turn: Turn) {    const agent = this.agents.find((a) => a.id === agentId);
    if (!agent) return;
    const sessionId = this.sessions.get(agentId);
    const prompt = sessionId
      ? this.buildIncrementalPrompt(agent, turn.trigger)
      : this.buildPrompt(agent, turn.trigger);

    let result: { text: string; sessionId?: string };
    try {
      result = await this.call(agent, prompt, sessionId);
    } catch (err) {
      if (!sessionId) {
        this.fail(agent, err);
        return;
      }
      // 续聊失败（会话过期/丢失等）：清掉会话，降级为全量无状态调用重试一次
      console.warn(
        `[room ${this.info.id}] @${agentId} 续聊失败，降级为全量调用:`,
        err instanceof Error ? err.message : err,
      );
      this.sessions.delete(agentId);
      this.deps.deleteSession(this.info.id, agentId);
      try {
        result = await this.call(agent, this.buildPrompt(agent, turn.trigger));
      } catch (err2) {
        this.fail(agent, err2);
        return;
      }
    }

    if (result.sessionId) {
      this.sessions.set(agentId, result.sessionId);
      this.deps.saveSession(this.info.id, agentId, result.sessionId);
      this.deps.emit({ type: "sessions_changed", roomId: this.info.id });
    }
    const reply = result.text;
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

  private async call(
    agent: AgentConfig,
    prompt: string,
    sessionId?: string,
  ): Promise<{ text: string; sessionId?: string }> {
    const onChunk = this.streaming
      ? (text: string) =>
          this.deps.emit({
            type: "draft",
            roomId: this.info.id,
            agentId: agent.id,
            text,
            ts: Date.now(),
          })
      : undefined;
    try {
      const res = await this.deps.invoke(agent, prompt, this.info.cwd, sessionId, onChunk);
      return typeof res === "string" ? { text: res } : res;
    } finally {
      if (onChunk) {
        this.deps.emit({
          type: "draft",
          roomId: this.info.id,
          agentId: agent.id,
          text: "",
          ts: Date.now(),
        });
      }
    }
  }

  private fail(agent: AgentConfig, err: unknown) {
    this.record(
      "system",
      "system",
      `⚠️ ${agent.name} 调用失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  /** 续聊轮 prompt：只带自该 agent 上次发言后的增量消息（CLI 会话里已有完整上下文） */
  private buildIncrementalPrompt(agent: AgentConfig, trigger: ChatMessage): string {
    const since = this.lastTurnAt.get(agent.id) ?? 0;
    const gap = this.messages
      .filter((m) => m.ts > since && m.author !== agent.id && m.id !== trigger.id)
      .slice(-20);
    const gapText = gap
      .map((m) => {
        const who =
          m.kind === "user" ? "user" : m.kind === "system" ? "system" : `@${m.author}`;
        const text =
          m.text.length > MAX_TEXT ? m.text.slice(0, MAX_TEXT) + "…(截断)" : m.text;
        return `[${who}]: ${text}`;
      })
      .join("\n\n");

    return `你是 ${agent.name}（@${agent.id}），继续之前的协作（完整规则、角色设定与更早的对话见本会话开头）。
房间目录：${this.info.cwd}

=== 自你上次发言后房间里的新消息 ===
${gapText || "（无）"}

=== TRIGGER（需要你现在回应的消息） ===
[${trigger.kind === "user" ? "user" : `@${trigger.author}`}]: ${trigger.text}

现在轮到你发言。只输出你要发到聊天室里的内容，不要加任何前缀或解释。`;
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
    // 其他正在工作的 agent 状态，让被触发的 agent 感知房间动态
    const busy = this.agents.filter(
      (a) => a.id !== agent.id && this.running.has(a.id),
    );
    const busySection =
      busy.length > 0
        ? `\n=== 房间当前状态 ===\n${busy
            .map((a) => {
              const files = this.recentFilesOf(a.id);
              return `@${a.id} 正在工作${files.length > 0 ? `（最近改动：${files.slice(-5).join("、")}）` : ""}`;
            })
            .join("\n")}\n`
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
7. 聊天室只承载讨论与决策：不要在回复里粘贴大段代码或文件内容。动手干活后用几句话汇报你做了什么、改动了哪些文件、关键决策和理由即可，细节让其他人自己去看文件。
${busySection}
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
