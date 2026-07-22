import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** bot 提交的署名（不依赖用户 git 配置） */
const IDENTITY = ["-c", "user.name=Agent Studio", "-c", "user.email=agent-studio@local"];

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", [...IDENTITY, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function isGitRepo(cwd: string): boolean {
  try {
    git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** 确保目录是 git 仓库（不是则 init + 空提交打底） */
export function ensureGitRepo(cwd: string): boolean {
  if (isGitRepo(cwd)) return true;
  try {
    git(cwd, ["init"]);
    git(cwd, ["commit", "--allow-empty", "-m", "chore: agent-studio init"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把工作区当前状态快照到 agent/<id> 分支。
 * 使用独立临时 index，不切换分支、不污染用户的暂存区。
 * 返回 commit hash；无变更或失败返回 null。
 */
export function snapshotAgentBranch(
  cwd: string,
  agentId: string,
  message: string,
): string | null {
  const idxDir = mkdtempSync(path.join(tmpdir(), "as-git-"));
  const idxFile = path.join(idxDir, "index");
  try {
    const env = { GIT_INDEX_FILE: idxFile };
    try {
      git(cwd, ["read-tree", "HEAD"], env);
    } catch {
      /* 仓库可能无提交 */
    }
    git(cwd, ["add", "-A"], env);
    const tree = git(cwd, ["write-tree"], env);
    const branch = `agent/${agentId}`;
    // 分支无变化则跳过
    try {
      const tip = git(cwd, ["rev-parse", branch]);
      if (git(cwd, ["rev-parse", `${tip}^{tree}`]) === tree) return null;
    } catch {
      /* 分支不存在 */
    }
    let parents: string[] = [];
    try {
      parents = ["-p", git(cwd, ["rev-parse", branch])];
    } catch {
      try {
        parents = ["-p", git(cwd, ["rev-parse", "HEAD"])];
      } catch {
        parents = [];
      }
    }
    const commit = git(cwd, ["commit-tree", tree, ...parents, "-m", message], env);
    git(cwd, ["update-ref", `refs/heads/${branch}`, commit]);
    return commit;
  } catch {
    return null;
  } finally {
    rmSync(idxDir, { recursive: true, force: true });
  }
}

export interface BranchStat {
  agentId: string;
  files: number;
  insertions: number;
  deletions: number;
}

/** agent/<id> 分支相对 HEAD 的 diffstat */
export function branchStat(cwd: string, agentId: string): BranchStat | null {
  try {
    const branch = `agent/${agentId}`;
    git(cwd, ["rev-parse", "--verify", branch]);
    const out = git(cwd, ["diff", "--shortstat", `HEAD...${branch}`]);
    return {
      agentId,
      files: Number(out.match(/(\d+) files? changed/)?.[1] ?? 0),
      insertions: Number(out.match(/(\d+) insertions?/)?.[1] ?? 0),
      deletions: Number(out.match(/(\d+) deletions?/)?.[1] ?? 0),
    };
  } catch {
    return null;
  }
}
