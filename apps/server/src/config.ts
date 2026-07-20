import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AgentInfo } from "@agent-studio/shared";

/** agents.config.json 中的一条 agent 定义 */
export interface AgentConfig extends AgentInfo {
  cmd: string;
  args: string[];
}

export const serverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const configPath =
  process.env.AGENT_STUDIO_CONFIG ??
  path.resolve(serverRoot, "../../agents.config.json");

export function loadAgents(file = configPath): AgentConfig[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    agents: AgentConfig[];
  };
  return raw.agents;
}
