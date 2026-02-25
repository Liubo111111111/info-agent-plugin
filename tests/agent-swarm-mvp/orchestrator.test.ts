import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTasks,
  ensureProject,
  notifyReadyTasks,
  readRegistry,
  runCheckCycle,
  spawnTask
} from "../../projects/agent-swarm-mvp/src/orchestrator.js";

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "swarm-mvp-"));
}

function writeEvidence(rootDir: string, taskId: string, payload: unknown): void {
  const evidenceDir = path.join(rootDir, "registry", "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, `${taskId}.json`),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

const rootsToDelete: string[] = [];

afterEach(() => {
  for (const root of rootsToDelete.splice(0, rootsToDelete.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent-swarm-mvp orchestrator", () => {
  it("spawns a task and persists it in registry", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    const task = spawnTask(root, {
      id: "feat-custom-templates",
      title: "Custom templates",
      repo: "medialyst",
      branch: "feat/custom-templates",
      agent: "codex",
      maxRetries: 2
    });

    expect(task.status).toBe("running");
    expect(task.retries).toBe(0);
    expect(fs.existsSync(task.worktreePath)).toBe(true);

    const registry = readRegistry(root);
    expect(registry.tasks).toHaveLength(1);
    expect(registry.tasks[0].id).toBe("feat-custom-templates");
  });

  it("moves task to ready when evidence checks all pass", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    spawnTask(root, {
      id: "feat-1",
      title: "Feature 1",
      repo: "demo",
      branch: "feat/1",
      agent: "codex",
      maxRetries: 2
    });
    writeEvidence(root, "feat-1", {
      checks: {
        prCreated: true,
        ciPassed: true,
        reviewPassed: true,
        uiScreenshotIncluded: true
      }
    });

    const result = runCheckCycle(root);
    expect(result.ready).toBe(1);

    const registry = readRegistry(root);
    expect(registry.tasks[0].status).toBe("ready");
  });

  it("retries and eventually fails when retryable failures persist", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    spawnTask(root, {
      id: "feat-2",
      title: "Feature 2",
      repo: "demo",
      branch: "feat/2",
      agent: "codex",
      maxRetries: 1
    });

    writeEvidence(root, "feat-2", {
      checks: {
        prCreated: true,
        ciPassed: false,
        reviewPassed: true,
        uiScreenshotIncluded: true
      },
      retryableFailure: true
    });

    const first = runCheckCycle(root);
    expect(first.retried).toBe(1);
    expect(readRegistry(root).tasks[0].status).toBe("running");
    expect(readRegistry(root).tasks[0].retries).toBe(1);

    const second = runCheckCycle(root);
    expect(second.failed).toBe(1);
    expect(readRegistry(root).tasks[0].status).toBe("failed");
  });

  it("writes one notification per ready task and is idempotent", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    spawnTask(root, {
      id: "feat-3",
      title: "Feature 3",
      repo: "demo",
      branch: "feat/3",
      agent: "codex",
      maxRetries: 2
    });
    writeEvidence(root, "feat-3", {
      checks: {
        prCreated: true,
        ciPassed: true,
        reviewPassed: true,
        uiScreenshotIncluded: true
      }
    });

    runCheckCycle(root);
    const first = notifyReadyTasks(root);
    const second = notifyReadyTasks(root);

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);

    const logPath = path.join(root, "output", "notifications.log");
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("feat-3");
  });

  it("cleans up old terminal tasks and removes worktrees", () => {
    const root = makeTmpRoot();
    rootsToDelete.push(root);
    ensureProject(root);

    const task = spawnTask(root, {
      id: "feat-4",
      title: "Feature 4",
      repo: "demo",
      branch: "feat/4",
      agent: "codex",
      maxRetries: 2
    });

    const registry = readRegistry(root);
    registry.tasks[0].status = "failed";
    registry.tasks[0].updatedAt = new Date("2000-01-01T00:00:00.000Z").toISOString();
    fs.writeFileSync(
      path.join(root, "registry", "active-tasks.json"),
      JSON.stringify(registry, null, 2),
      "utf8"
    );
    expect(fs.existsSync(task.worktreePath)).toBe(true);

    const result = cleanupTasks(root, 1);
    expect(result.removed).toBe(1);
    expect(fs.existsSync(task.worktreePath)).toBe(false);
    expect(readRegistry(root).tasks).toHaveLength(0);
  });
});
