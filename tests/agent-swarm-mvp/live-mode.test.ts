import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTasks,
  createPullRequest,
  ensureProject,
  readRegistry,
  runCheckCycle,
  sendInstruction,
  spawnTask
} from "../../projects/agent-swarm-mvp/src/orchestrator.js";

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "swarm-live-"));
}

function createRunner(
  resolver: (call: { command: string; args: string[]; cwd?: string }) => {
    code?: number;
    stdout?: string;
    stderr?: string;
  }
) {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  return {
    calls,
    runCommand: (command: string, args: string[], options?: { cwd?: string }) => {
      const call = { command, args, cwd: options?.cwd };
      calls.push(call);
      const result = resolver(call);
      return {
        code: result.code ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? ""
      };
    }
  };
}

const rootsToDelete: string[] = [];

afterEach(() => {
  for (const root of rootsToDelete.splice(0, rootsToDelete.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent-swarm-mvp live mode", () => {
  it("spawns task with real git worktree and tmux commands", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    const runner = createRunner((call) => {
      if (call.command === "git" && call.args[0] === "worktree") {
        const worktreePath = call.args[3];
        fs.mkdirSync(worktreePath, { recursive: true });
      }
      return {};
    });

    const task = spawnTask(
      root,
      {
        id: "live-1",
        title: "Live Task",
        repo: "demo",
        branch: "feat/live-1",
        agent: "codex",
        live: true,
        repoRoot: root,
        baseRef: "origin/main",
        agentCommand: "echo run",
        sessionName: "codex-live-1"
      },
      { runCommand: runner.runCommand }
    );

    expect(task.live?.enabled).toBe(true);
    expect(runner.calls.some((c) => c.command === "git" && c.args[0] === "worktree")).toBe(true);
    expect(runner.calls.some((c) => c.command === "tmux" && c.args[0] === "new-session")).toBe(true);
  });

  it("marks live task as ready when gh PR checks are passing", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    const runner = createRunner((call) => {
      if (call.command === "git" && call.args[0] === "worktree") {
        fs.mkdirSync(call.args[3], { recursive: true });
      }
      if (call.command === "gh" && call.args[0] === "pr" && call.args[1] === "list") {
        return {
          stdout: JSON.stringify([{ number: 341, url: "https://github.com/org/repo/pull/341" }])
        };
      }
      if (call.command === "gh" && call.args[0] === "pr" && call.args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 341,
            url: "https://github.com/org/repo/pull/341",
            state: "OPEN",
            isDraft: false,
            reviewDecision: "APPROVED",
            statusCheckRollup: [{ state: "SUCCESS" }, { state: "SUCCESS" }],
            body: "![ui](https://example.com/ui.png)"
          })
        };
      }
      return {};
    });

    spawnTask(
      root,
      {
        id: "live-2",
        title: "Live Task 2",
        repo: "demo",
        branch: "feat/live-2",
        agent: "codex",
        live: true,
        repoRoot: root,
        requireReview: true,
        requireScreenshot: true
      },
      { runCommand: runner.runCommand }
    );

    const result = runCheckCycle(root, { runCommand: runner.runCommand });
    expect(result.ready).toBe(1);

    const task = readRegistry(root).tasks[0];
    expect(task.status).toBe("ready");
    expect(task.pr?.number).toBe(341);
    expect(task.checks.ciPassed).toBe(true);
    expect(task.checks.reviewPassed).toBe(true);
  });

  it("can send tmux instruction and create PR via gh", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    const runner = createRunner((call) => {
      if (call.command === "git" && call.args[0] === "worktree") {
        fs.mkdirSync(call.args[3], { recursive: true });
      }
      if (call.command === "gh" && call.args[0] === "pr" && call.args[1] === "create") {
        return { stdout: "https://github.com/org/repo/pull/500\n" };
      }
      return {};
    });

    spawnTask(
      root,
      {
        id: "live-3",
        title: "Live Task 3",
        repo: "demo",
        branch: "feat/live-3",
        agent: "codex",
        live: true,
        repoRoot: root,
        baseRef: "origin/main",
        sessionName: "codex-live-3"
      },
      { runCommand: runner.runCommand }
    );

    sendInstruction(root, "live-3", "Focus on API first", { runCommand: runner.runCommand });
    const pr = createPullRequest(root, "live-3", { runCommand: runner.runCommand });

    expect(pr.url).toContain("/pull/500");
    expect(
      runner.calls.some(
        (c) => c.command === "tmux" && c.args[0] === "send-keys" && c.args.includes("Focus on API first")
      )
    ).toBe(true);
    expect(
      runner.calls.some((c) => c.command === "gh" && c.args[0] === "pr" && c.args[1] === "create")
    ).toBe(true);
  });

  it("cleanup removes live worktree via git and kills tmux session", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    const runner = createRunner((call) => {
      if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") {
        fs.mkdirSync(call.args[3], { recursive: true });
      }
      return {};
    });

    const task = spawnTask(
      root,
      {
        id: "live-4",
        title: "Live Task 4",
        repo: "demo",
        branch: "feat/live-4",
        agent: "codex",
        live: true,
        repoRoot: root,
        sessionName: "codex-live-4"
      },
      { runCommand: runner.runCommand }
    );

    const registry = readRegistry(root);
    registry.tasks[0].status = "failed";
    registry.tasks[0].updatedAt = new Date("2000-01-01T00:00:00.000Z").toISOString();
    fs.writeFileSync(
      path.join(root, "registry", "active-tasks.json"),
      JSON.stringify(registry, null, 2),
      "utf8"
    );

    const result = cleanupTasks(root, 1, { runCommand: runner.runCommand });
    expect(result.removed).toBe(1);
    expect(fs.existsSync(task.worktreePath)).toBe(false);
    expect(
      runner.calls.some((c) => c.command === "tmux" && c.args[0] === "kill-session")
    ).toBe(true);
    expect(
      runner.calls.some(
        (c) =>
          c.command === "git" &&
          c.args[0] === "worktree" &&
          c.args[1] === "remove" &&
          c.args.includes("--force")
      )
    ).toBe(true);
  });
});
