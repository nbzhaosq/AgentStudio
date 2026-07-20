import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AgentDef } from "@agent-studio/shared";

/** agents.config.json 中的一条 agent 定义 */
export type AgentConfig = AgentDef;

export const serverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const configPath =
  process.env.AGENT_STUDIO_CONFIG ??
  path.resolve(serverRoot, "../../agents.config.json");

/** 读取种子配置（首次启动导入 SQLite 用） */
export function loadAgents(file = configPath): AgentDef[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    agents: AgentDef[];
  };
  return raw.agents;
}
