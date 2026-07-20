import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { ChatMessage, RoomInfo } from "@agent-studio/shared";

/** JSONL 持久化：~/.agent-studio/rooms.json + rooms/<id>.jsonl */
export class Store {
  readonly dir: string;

  constructor(dir = process.env.AGENT_STUDIO_DATA_DIR ?? path.join(homedir(), ".agent-studio")) {
    this.dir = dir;
    mkdirSync(path.join(dir, "rooms"), { recursive: true });
  }

  private roomsFile() {
    return path.join(this.dir, "rooms.json");
  }

  loadRooms(): RoomInfo[] {
    if (!existsSync(this.roomsFile())) return [];
    return JSON.parse(readFileSync(this.roomsFile(), "utf8")) as RoomInfo[];
  }

  saveRoom(room: RoomInfo) {
    const rooms = this.loadRooms().filter((r) => r.id !== room.id);
    rooms.push(room);
    writeFileSync(this.roomsFile(), JSON.stringify(rooms, null, 2));
  }

  private messagesFile(roomId: string) {
    return path.join(this.dir, "rooms", `${roomId}.jsonl`);
  }

  appendMessage(msg: ChatMessage) {
    appendFileSync(this.messagesFile(msg.roomId), JSON.stringify(msg) + "\n");
  }

  loadMessages(roomId: string): ChatMessage[] {
    const file = this.messagesFile(roomId);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ChatMessage);
  }
}
