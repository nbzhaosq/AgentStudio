import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { branchStat, ensureGitRepo, isGitRepo, snapshotAgentBranch } from "../src/git.js";

function tmp() {
  return mkdtempSync(path.join(tmpdir(), "as-git-test-"));
}

describe("git 工作流", () => {
  it("ensureGitRepo 初始化非仓库目录", () => {
    const dir = tmp();
    expect(isGitRepo(dir)).toBe(false);
    expect(ensureGitRepo(dir)).toBe(true);
    expect(isGitRepo(dir)).toBe(true);
  });

  it("snapshotAgentBranch 快照变更到 agent 分支并可 diffstat", () => {
    const dir = tmp();
    ensureGitRepo(dir);
    writeFileSync(path.join(dir, "a.ts"), "export const x = 1;\n");
    const commit = snapshotAgentBranch(dir, "kimi", "agent(kimi): 加 a.ts");
    expect(commit).toBeTruthy();

    const stat = branchStat(dir, "kimi");
    expect(stat).toMatchObject({ agentId: "kimi", files: 1, insertions: 1 });
  });

  it("无变更时快照返回 null", () => {
    const dir = tmp();
    ensureGitRepo(dir);
    writeFileSync(path.join(dir, "a.ts"), "x\n");
    expect(snapshotAgentBranch(dir, "kimi", "first")).toBeTruthy();
    // 不再改动 → 第二个快照为 null
    expect(snapshotAgentBranch(dir, "kimi", "second")).toBeNull();
  });

  it("每个 agent 有独立分支", () => {
    const dir = tmp();
    ensureGitRepo(dir);
    writeFileSync(path.join(dir, "a.ts"), "x\n");
    snapshotAgentBranch(dir, "kimi", "k1");
    writeFileSync(path.join(dir, "b.ts"), "y\n");
    snapshotAgentBranch(dir, "claude", "c1");
    expect(branchStat(dir, "kimi")?.files).toBe(1);
    expect(branchStat(dir, "claude")?.files).toBe(2);
  });
});
