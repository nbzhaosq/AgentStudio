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
    `);
    // 老库迁移：补充 system_prompt 列
    const agentCols = this.db
      .prepare("PRAGMA table_info(agents)")
      .all()
      .map((r) => (r as { name: string }).name);
    if (!agentCols.includes("system_prompt")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN system_prompt TEXT");
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
    }));
  }

  getAgent(id: string): AgentDef | undefined {
    return this.listAgents().find((a) => a.id === id);
  }

  upsertAgent(agent: AgentDef) {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, color, cmd, args, instructions, system_prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           cmd = excluded.cmd,
           args = excluded.args,
           instructions = excluded.instructions,
           system_prompt = excluded.system_prompt`,
      )
      .run(
        agent.id,
        agent.name,
        agent.color,
        agent.cmd,
        JSON.stringify(agent.args),
        agent.instructions ?? null,
        agent.systemPrompt ?? null,
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
    }));
  }

  saveRoom(room: RoomInfo) {
    this.db
      .prepare(
        `INSERT INTO rooms (id, name, cwd, agent_ids, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           cwd = excluded.cwd,
           agent_ids = excluded.agent_ids`,
      )
      .run(room.id, room.name, room.cwd, JSON.stringify(room.agentIds), room.createdAt);
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
