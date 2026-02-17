import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "routing-contract-sync-"));
  tempDirs.push(dir);
  return dir;
}

function runScript(scriptPath: string, args: string[], env: Record<string, string>) {
  return spawnSync("bash", [scriptPath, ...args], {
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("auto routing contract sync scripts", () => {
  it("sync-auto-routing-contract copies local contract docs into repo mirror", () => {
    const root = createTempDir();
    const localDir = path.join(root, "local-contracts");
    const repoDir = path.join(root, "repo-contracts");

    fs.mkdirSync(localDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, "auto-routing-contract.md"), "# local contract\n", "utf8");
    fs.writeFileSync(path.join(localDir, "auto-routing-capability-map.md"), "# local map\n", "utf8");
    fs.writeFileSync(path.join(repoDir, "old.md"), "old\n", "utf8");

    const scriptPath = path.join(process.cwd(), "scripts", "sync-auto-routing-contract.sh");
    const result = runScript(scriptPath, ["--from-local"], {
      LOCAL_CONTRACT_DIR: localDir,
      REPO_CONTRACT_DIR: repoDir,
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(repoDir, "auto-routing-contract.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "auto-routing-capability-map.md"))).toBe(true);
    expect(fs.readFileSync(path.join(repoDir, "auto-routing-contract.md"), "utf8")).toContain("local contract");
  });

  it("check-auto-routing-contract-sync passes when equal and fails with status 2 when diverged", () => {
    const root = createTempDir();
    const localDir = path.join(root, "local-contracts");
    const repoDir = path.join(root, "repo-contracts");

    fs.mkdirSync(localDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });

    fs.writeFileSync(path.join(localDir, "auto-routing-contract.md"), "# same contract\n", "utf8");
    fs.writeFileSync(path.join(localDir, "auto-routing-capability-map.md"), "# same map\n", "utf8");
    fs.writeFileSync(path.join(repoDir, "auto-routing-contract.md"), "# same contract\n", "utf8");
    fs.writeFileSync(path.join(repoDir, "auto-routing-capability-map.md"), "# same map\n", "utf8");

    const scriptPath = path.join(process.cwd(), "scripts", "check-auto-routing-contract-sync.sh");

    const okResult = runScript(scriptPath, [], {
      LOCAL_CONTRACT_DIR: localDir,
      REPO_CONTRACT_DIR: repoDir,
    });
    expect(okResult.status).toBe(0);

    fs.writeFileSync(path.join(localDir, "auto-routing-contract.md"), "# changed contract\n", "utf8");

    const diffResult = runScript(scriptPath, [], {
      LOCAL_CONTRACT_DIR: localDir,
      REPO_CONTRACT_DIR: repoDir,
    });
    expect(diffResult.status).toBe(2);
    expect(diffResult.stdout).toContain("out of sync");
  });
});
