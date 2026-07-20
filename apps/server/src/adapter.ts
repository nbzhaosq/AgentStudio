import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentConfig } from "./config.js";
import { serverRoot } from "./config.js";

/** 单次调用超时，默认 10 分钟，可用环境变量覆盖 */
const TIMEOUT_MS = Number(process.env.AGENT_STUDIO_TIMEOUT_MS ?? 10 * 60 * 1000);

/**
 * 调用一个 CLI agent：按 args 模板替换占位符后 spawn，
 * 返回其最终回复文本。
 *
 * 占位符：
 * - {prompt}    本轮完整 prompt（作为单个 argv 元素传入，无 shell 转义问题）
 * - {outfile}   临时文件路径；若模板使用了它，回复从该文件读取（如 codex -o）
 * - {cwd}       房间工作目录
 * - {serverRoot} server 代码根目录（用于定位内置脚本）
 */
export function invokeAgent(
  agent: AgentConfig,
  prompt: string,
  cwd: string,
): Promise<string> {
  const usesOutfile = agent.args.some((a) => a.includes("{outfile}"));
  const outDir = usesOutfile ? mkdtempSync(path.join(tmpdir(), "agent-studio-")) : null;
  const outfile = outDir ? path.join(outDir, "reply.txt") : "";

  const args = agent.args.map((a) =>
    a
      .replaceAll("{prompt}", prompt)
      .replaceAll("{outfile}", outfile)
      .replaceAll("{cwd}", cwd)
      .replaceAll("{serverRoot}", serverRoot),
  );

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
      resolve(reply);
    });
  });
}
