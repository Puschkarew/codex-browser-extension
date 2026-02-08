import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-sync-"));
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

describe("fix-app-bugs skill sync scripts", () => {
  it("sync-fix-app-bugs-skill copies local skill tree into repo mirror", () => {
    const root = createTempDir();
    const localDir = path.join(root, "local-skill");
    const repoDir = path.join(root, "repo-skill");

    fs.mkdirSync(path.join(localDir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(localDir, "SKILL.md"), "# local\n");
    fs.writeFileSync(path.join(localDir, "scripts", "bootstrap_guarded.py"), "print('ok')\n");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, "old.txt"), "old\n");

    const scriptPath = path.join(process.cwd(), "scripts", "sync-fix-app-bugs-skill.sh");
    const result = runScript(scriptPath, ["--from-local"], {
      LOCAL_SKILL_ROOT: localDir,
      REPO_SKILL_ROOT: repoDir,
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(repoDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "scripts", "bootstrap_guarded.py"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "old.txt"))).toBe(false);
  });

  it("check-fix-app-bugs-sync passes when equal and fails with status 2 when diverged", () => {
    const root = createTempDir();
    const localDir = path.join(root, "local-skill");
    const repoDir = path.join(root, "repo-skill");

    fs.mkdirSync(localDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, "SKILL.md"), "# same\n");
    fs.writeFileSync(path.join(repoDir, "SKILL.md"), "# same\n");

    const scriptPath = path.join(process.cwd(), "scripts", "check-fix-app-bugs-sync.sh");

    const okResult = runScript(scriptPath, [], {
      LOCAL_SKILL_ROOT: localDir,
      REPO_SKILL_ROOT: repoDir,
    });
    expect(okResult.status).toBe(0);

    fs.writeFileSync(path.join(localDir, "SKILL.md"), "# changed\n");

    const diffResult = runScript(scriptPath, [], {
      LOCAL_SKILL_ROOT: localDir,
      REPO_SKILL_ROOT: repoDir,
    });
    expect(diffResult.status).toBe(2);
    expect(diffResult.stdout).toContain("out of sync");
  });
});
