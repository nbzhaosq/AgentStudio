import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { AgentDef, ChatMessage, RoomInfo } from "@agent-studio/shared";

/**
 * SQLite 持久化：<dataDir>/studio.db，三张表 agents / rooms / messages。
 * 首次启动时若 agents 表为空且存在 agents.config.json 种子文件则导入；
 * 若存在旧的 JSONL 数据（rooms.json + rooms/*.jsonl）且 rooms 表为空则自动迁移。
 */
export class Store {
  readonly dir: string;
  private db: DatabaseSync;

  constructor(
    dir = process.env.AGENT_STUDIO_DATA_DIR ?? path.join(homedir(), ".agent-studio"),
  ) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "studio.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#888888',
        cmd TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        instructions TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        agent_ids TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        author TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        mentions TEXT NOT NULL DEFAULT '[]',
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, ts);
      CREATE TABLE IF NOT EXISTS room_sessions (
        room_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, agent_id)
      );
    `);
    // 老库迁移：补充 system_prompt 列
    const agentCols = this.db
      .prepare("PRAGMA table_info(agents)")
      .all()
      .map((r) => (r as { name: string }).name);
    if (!agentCols.includes("system_prompt")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN system_prompt TEXT");
    }
    // 老库迁移：补充会话续聊列
    if (!agentCols.includes("session_start_args")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN session_start_args TEXT");
      this.db.exec("ALTER TABLE agents ADD COLUMN session_resume_args TEXT");
      this.db.exec("ALTER TABLE agents ADD COLUMN session_capture TEXT");
    }
    // 老库迁移：补充流式输出列
    if (!agentCols.includes("stream_args_extra")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN stream_args_extra TEXT");
      this.db.exec("ALTER TABLE agents ADD COLUMN stream_format TEXT");
    }
    // 老库迁移：rooms 补充自驱讨论列
    const roomCols = this.db
      .prepare("PRAGMA table_info(rooms)")
      .all()
      .map((r) => (r as { name: string }).name);
    if (!roomCols.includes("auto_discuss")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN auto_discuss INTEGER NOT NULL DEFAULT 0");
      this.db.exec("ALTER TABLE rooms ADD COLUMN moderator_id TEXT");
    }
    this.migrateLegacyJsonl();
  }

  // ---------- agents ----------

  listAgents(): AgentDef[] {
    const rows = this.db
      .prepare("SELECT * FROM agents ORDER BY created_at")
      .all() as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      color: r.color as string,
      cmd: r.cmd as string,
      args: JSON.parse(r.args as string) as string[],
      instructions: (r.instructions as string | null) ?? undefined,
      systemPrompt: (r.system_prompt as string | null) ?? undefined,
      sessionStartArgs: r.session_start_args
        ? (JSON.parse(r.session_start_args as string) as string[])
        : undefined,
      sessionResumeArgs: r.session_resume_args
        ? (JSON.parse(r.session_resume_args as string) as string[])
        : undefined,
      sessionCapture: (r.session_capture as string | null) ?? undefined,
      streamArgsExtra: r.stream_args_extra
        ? (JSON.parse(r.stream_args_extra as string) as string[])
        : undefined,
      streamFormat:
        (r.stream_format as "claude-json" | "codex-json" | "kimi-json" | "text" | null) ??
        undefined,
    }));
  }

  getAgent(id: string): AgentDef | undefined {
    return this.listAgents().find((a) => a.id === id);
  }

  upsertAgent(agent: AgentDef) {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, color, cmd, args, instructions, system_prompt, session_start_args, session_resume_args, session_capture, stream_args_extra, stream_format, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           cmd = excluded.cmd,
           args = excluded.args,
           instructions = excluded.instructions,
           system_prompt = excluded.system_prompt,
           session_start_args = excluded.session_start_args,
           session_resume_args = excluded.session_resume_args,
           session_capture = excluded.session_capture,
           stream_args_extra = excluded.stream_args_extra,
           stream_format = excluded.stream_format`,
      )
      .run(
        agent.id,
        agent.name,
        agent.color,
        agent.cmd,
        JSON.stringify(agent.args),
        agent.instructions ?? null,
        agent.systemPrompt ?? null,
        agent.sessionStartArgs ? JSON.stringify(agent.sessionStartArgs) : null,
        agent.sessionResumeArgs ? JSON.stringify(agent.sessionResumeArgs) : null,
        agent.sessionCapture ?? null,
        agent.streamArgsExtra ? JSON.stringify(agent.streamArgsExtra) : null,
        agent.streamFormat ?? null,
        Date.now(),
      );
  }

  deleteAgent(id: string) {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }

  /** 从种子 JSON 导入 agents（仅在 agents 表为空时调用） */
  importAgents(agents: AgentDef[]) {
    for (const a of agents) this.upsertAgent(a);
  }

  // ---------- rooms ----------

  loadRooms(): RoomInfo[] {
    const rows = this.db
      .prepare("SELECT * FROM rooms ORDER BY created_at")
      .all() as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      cwd: r.cwd as string,
      agentIds: JSON.parse(r.agent_ids as string) as string[],
      createdAt: r.created_at as number,
      autoDiscuss: r.auto_discuss === 1,
      moderatorId: (r.moderator_id as string | null) ?? undefined,
    }));
  }

  saveRoom(room: RoomInfo) {
    this.db
      .prepare(
        `INSERT INTO rooms (id, name, cwd, agent_ids, created_at, auto_discuss, moderator_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           cwd = excluded.cwd,
           agent_ids = excluded.agent_ids,
           auto_discuss = excluded.auto_discuss,
           moderator_id = excluded.moderator_id`,
      )
      .run(
        room.id,
        room.name,
        room.cwd,
        JSON.stringify(room.agentIds),
        room.createdAt,
        room.autoDiscuss ? 1 : 0,
        room.moderatorId ?? null,
      );
  }

  // ---------- messages ----------

  appendMessage(msg: ChatMessage) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO messages (id, room_id, author, kind, text, mentions, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msg.id,
        msg.roomId,
        msg.author,
        msg.kind,
        msg.text,
        JSON.stringify(msg.mentions),
        msg.ts,
      );
  }

  loadMessages(roomId: string): ChatMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY ts")
      .all(roomId) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      roomId: r.room_id as string,
      author: r.author as string,
      kind: r.kind as ChatMessage["kind"],
      text: r.text as string,
      mentions: JSON.parse(r.mentions as string) as string[],
      ts: r.ts as number,
    }));
  }

  // ---------- room sessions（agent 的 CLI 会话续聊状态） ----------

  getSessions(roomId: string): Record<string, string> {
    const rows = this.db
      .prepare("SELECT agent_id, session_id FROM room_sessions WHERE room_id = ?")
      .all(roomId) as unknown as { agent_id: string; session_id: string }[];
    return Object.fromEntries(rows.map((r) => [r.agent_id, r.session_id]));
  }

  /** 带时间戳的会话行（管理界面用） */
  getSessionRows(
    roomId: string,
  ): { agentId: string; sessionId: string; updatedAt: number }[] {
    const rows = this.db
      .prepare(
        "SELECT agent_id, session_id, updated_at FROM room_sessions WHERE room_id = ? ORDER BY agent_id",
      )
      .all(roomId) as unknown as {
      agent_id: string;
      session_id: string;
      updated_at: number;
    }[];
    return rows.map((r) => ({
      agentId: r.agent_id,
      sessionId: r.session_id,
      updatedAt: r.updated_at,
    }));
  }

  saveSession(roomId: string, agentId: string, sessionId: string) {
    this.db
      .prepare(
        `INSERT INTO room_sessions (room_id, agent_id, session_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(room_id, agent_id) DO UPDATE SET
           session_id = excluded.session_id,
           updated_at = excluded.updated_at`,
      )
      .run(roomId, agentId, sessionId, Date.now());
  }

  deleteSession(roomId: string, agentId: string) {
    this.db
      .prepare("DELETE FROM room_sessions WHERE room_id = ? AND agent_id = ?")
      .run(roomId, agentId);
  }

  deleteRoomSessions(roomId: string) {
    this.db.prepare("DELETE FROM room_sessions WHERE room_id = ?").run(roomId);
  }

  // ---------- 旧数据迁移 ----------

  private migrateLegacyJsonl() {
    const legacyRoomsFile = path.join(this.dir, "rooms.json");
    if (!existsSync(legacyRoomsFile)) return;
    const hasRooms = this.db.prepare("SELECT 1 FROM rooms LIMIT 1").get();
    if (hasRooms) return;
    try {
      const rooms = JSON.parse(readFileSync(legacyRoomsFile, "utf8")) as RoomInfo[];
      for (const room of rooms) {
        this.saveRoom(room);
        const msgFile = path.join(this.dir, "rooms", `${room.id}.jsonl`);
        if (!existsSync(msgFile)) continue;
        for (const line of readFileSync(msgFile, "utf8").split("\n")) {
          if (!line.trim()) continue;
          this.appendMessage(JSON.parse(line) as ChatMessage);
        }
      }
      console.log(`已从旧 JSONL 数据迁移 ${rooms.length} 个房间`);
    } catch (err) {
      console.error("旧数据迁移失败（忽略，继续使用空库）:", err);
    }
  }
}
