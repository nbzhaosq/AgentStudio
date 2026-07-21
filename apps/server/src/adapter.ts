import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentConfig } from "./config.js";
import { serverRoot } from "./config.js";

/** 单次调用超时，默认 10 分钟，可用环境变量覆盖 */
const TIMEOUT_MS = Number(process.env.AGENT_STUDIO_TIMEOUT_MS ?? 10 * 60 * 1000);

export interface InvokeResult {
  text: string;
  /** 本轮建立/确认了的 CLI 会话 id（用于后续续聊） */
  sessionId?: string;
}

/** 用变量表替换 args 模板中的占位符 */
export function buildArgs(template: string[], vars: Record<string, string>): string[] {
  return template.map((a) => {
    let out = a;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, v);
    }
    return out;
  });
}

/** 用配置的正则从输出中捕获 session id */
export function captureSessionId(
  pattern: string | undefined,
  output: string,
): string | undefined {
  if (!pattern) return undefined;
  const m = output.match(new RegExp(pattern));
  return m?.[1];
}

/**
 * 调用一个 CLI agent。
 *
 * 会话续聊语义：
 * - 传入 sessionId 且 agent 声明了 sessionResumeArgs → 用续聊模板；
 * - 未传入且声明了 sessionStartArgs → 生成 UUID 钉住新会话（钉 id 型）；
 * - 否则用普通 args，若声明了 sessionCapture 则从输出捕获会话 id（捕获型）。
 *
 * 占位符：{prompt} {outfile} {cwd} {serverRoot} {sessionId}
 */
export function invokeAgent(
  agent: AgentConfig,
  prompt: string,
  cwd: string,
  sessionId?: string,
): Promise<InvokeResult> {
  let template = agent.args;
  let pinnedId: string | undefined;
  if (sessionId && agent.sessionResumeArgs) {
    template = agent.sessionResumeArgs;
  } else if (!sessionId && agent.sessionStartArgs) {
    pinnedId = randomUUID();
    template = agent.sessionStartArgs;
  }

  const usesOutfile = template.some((a) => a.includes("{outfile}"));
  const outDir = usesOutfile
    ? mkdtempSync(path.join(tmpdir(), "agent-studio-"))
    : null;
  const outfile = outDir ? path.join(outDir, "reply.txt") : "";

  const args = buildArgs(template, {
    prompt,
    outfile,
    cwd,
    serverRoot,
    sessionId: sessionId ?? pinnedId ?? "",
  });

  return new Promise((resolve, reject) => {
    const child = spawn(agent.cmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      cleanup();
      reject(new Error(`${agent.id} 调用超时（${TIMEOUT_MS / 1000}s）`));
    }, TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      if (outDir) rmSync(outDir, { recursive: true, force: true });
    }

    child.on("error", (err) => {
      cleanup();
      reject(new Error(`无法启动 ${agent.cmd}: ${err.message}`));
    });

    child.on("close", (code) => {
      let reply = "";
      try {
        if (usesOutfile && outfile) {
          try {
            reply = readFileSync(outfile, "utf8");
          } catch {
            reply = "";
          }
        }
        if (!reply) reply = stdout.trim();
      } finally {
        cleanup();
      }
      if (code !== 0 && !reply) {
        reject(
          new Error(
            `${agent.id} 退出码 ${code}: ${stderr.trim().slice(0, 500) || "(无输出)"}`,
          ),
        );
        return;
      }
      resolve({
        text: reply,
        // 捕获型 CLI 的会话 id 提示有的走 stdout（codex/hermes），有的走 stderr（kimi）
        sessionId:
          pinnedId ?? captureSessionId(agent.sessionCapture, `${stdout}\n${stderr}`),
      });
    });
  });
}
