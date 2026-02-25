import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REGISTRY_VERSION = 1;
const TERMINAL_STATUSES = new Set(["done", "failed", "canceled"]);
const PASSING_CHECK_STATES = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function registryPath(rootDir) {
  return path.join(rootDir, "registry", "active-tasks.json");
}

function evidencePath(rootDir, taskId) {
  return path.join(rootDir, "registry", "evidence", `${taskId}.json`);
}

function notificationLogPath(rootDir) {
  return path.join(rootDir, "output", "notifications.log");
}

function writeRegistry(rootDir, registry) {
  fs.writeFileSync(registryPath(rootDir), JSON.stringify(registry, null, 2), "utf8");
}

function readEvidence(rootDir, taskId) {
  const file = evidencePath(rootDir, taskId);
  if (!fs.existsSync(file)) {
    return null;
  }
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

function normalizeChecks(payload) {
  const checks = payload?.checks ?? {};
  return {
    prCreated: checks.prCreated === true,
    ciPassed: checks.ciPassed === true,
    reviewPassed: checks.reviewPassed === true,
    uiScreenshotIncluded: checks.uiScreenshotIncluded !== false
  };
}

function checksPassed(checks) {
  return (
    checks.prCreated === true &&
    checks.ciPassed === true &&
    checks.reviewPassed === true &&
    checks.uiScreenshotIncluded === true
  );
}

function sanitizeSessionName(raw) {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function parseJsonOutput(stdout, fallback) {
  try {
    return JSON.parse(stdout);
  } catch {
    return fallback;
  }
}

function deriveBaseBranch(baseRef) {
  if (baseRef.startsWith("origin/")) {
    return baseRef.slice("origin/".length);
  }
  return baseRef;
}

function extractUrlFromText(rawText) {
  const match = rawText.match(/https?:\/\/\S+/);
  if (!match) {
    return "";
  }
  return match[0];
}

function defaultRunCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function runOrThrow(runCommand, command, args, options = {}) {
  const result = runCommand(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${(result.stderr || result.stdout).trim()}`
    );
  }
  return result;
}

function getRunner(options) {
  return options?.runCommand ?? defaultRunCommand;
}

function evaluateCiFromRollup(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) {
    return false;
  }
  for (const entry of rollup) {
    const state = String(entry?.state ?? "").toUpperCase();
    if (!PASSING_CHECK_STATES.has(state)) {
      return false;
    }
  }
  return true;
}

function evaluateReview(task, reviewDecision) {
  const decision = String(reviewDecision ?? "").toUpperCase();
  if (task.requireReview === true) {
    return decision === "APPROVED";
  }
  return decision !== "CHANGES_REQUESTED";
}

function evaluateScreenshot(task, prBody) {
  if (task.requireScreenshot !== true) {
    return true;
  }
  return typeof prBody === "string" && prBody.includes("![");
}

function evaluateLiveTask(task, runCommand) {
  const repoRoot = task.live.repoRoot;
  const sessionName = task.live.sessionName;
  const tmuxResult = runCommand("tmux", ["has-session", "-t", sessionName], { cwd: repoRoot });
  const tmuxAlive = tmuxResult.code === 0;

  const listResult = runCommand(
    "gh",
    ["pr", "list", "--head", task.branch, "--state", "open", "--json", "number,url,isDraft"],
    { cwd: task.worktreePath || repoRoot }
  );
  if (listResult.code !== 0) {
    return {
      checks: {
        prCreated: false,
        ciPassed: false,
        reviewPassed: false,
        uiScreenshotIncluded: task.requireScreenshot !== true
      },
      retryableFailure: !tmuxAlive,
      note: "gh pr list failed"
    };
  }

  const listItems = parseJsonOutput(listResult.stdout, []);
  if (!Array.isArray(listItems) || listItems.length === 0) {
    return {
      checks: {
        prCreated: false,
        ciPassed: false,
        reviewPassed: false,
        uiScreenshotIncluded: task.requireScreenshot !== true
      },
      retryableFailure: !tmuxAlive,
      note: tmuxAlive ? "Waiting for PR creation" : "Agent session ended before PR creation"
    };
  }

  const prHint = listItems[0];
  const viewResult = runCommand(
    "gh",
    [
      "pr",
      "view",
      String(prHint.number),
      "--json",
      "number,url,state,isDraft,reviewDecision,statusCheckRollup,body"
    ],
    { cwd: task.worktreePath || repoRoot }
  );
  if (viewResult.code !== 0) {
    return {
      checks: {
        prCreated: true,
        ciPassed: false,
        reviewPassed: false,
        uiScreenshotIncluded: task.requireScreenshot !== true
      },
      pr: {
        number: prHint.number,
        url: prHint.url || ""
      },
      retryableFailure: !tmuxAlive,
      note: "gh pr view failed"
    };
  }

  const view = parseJsonOutput(viewResult.stdout, {});
  const ciPassed = evaluateCiFromRollup(view.statusCheckRollup);
  const reviewPassed = evaluateReview(task, view.reviewDecision);
  const screenshotPassed = evaluateScreenshot(task, view.body);
  const prOpen = String(view.state || "").toUpperCase() === "OPEN" && view.isDraft !== true;

  return {
    checks: {
      prCreated: true,
      ciPassed: prOpen && ciPassed,
      reviewPassed,
      uiScreenshotIncluded: screenshotPassed
    },
    pr: {
      number: view.number ?? prHint.number,
      url: view.url ?? prHint.url ?? "",
      state: view.state ?? "",
      isDraft: view.isDraft === true
    },
    retryableFailure: !tmuxAlive && (!prOpen || !ciPassed || !reviewPassed || !screenshotPassed)
  };
}

function ensureLiveTask(task) {
  if (!task?.live?.enabled) {
    throw new Error(`Task ${task?.id ?? "<unknown>"} is not in live mode.`);
  }
}

function findTaskOrThrow(registry, taskId) {
  const task = registry.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

export function ensureProject(rootDir) {
  ensureDir(path.join(rootDir, "registry", "evidence"));
  ensureDir(path.join(rootDir, "worktrees"));
  ensureDir(path.join(rootDir, "output"));

  const regPath = registryPath(rootDir);
  if (!fs.existsSync(regPath)) {
    writeRegistry(rootDir, { version: REGISTRY_VERSION, tasks: [] });
  }
}

export function readRegistry(rootDir) {
  ensureProject(rootDir);
  const raw = fs.readFileSync(registryPath(rootDir), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.tasks)) {
    throw new Error("Invalid registry: tasks must be an array.");
  }
  return parsed;
}

export function spawnTask(rootDir, input, options = {}) {
  ensureProject(rootDir);
  const registry = readRegistry(rootDir);
  const runCommand = getRunner(options);

  if (registry.tasks.some((task) => task.id === input.id)) {
    throw new Error(`Task already exists: ${input.id}`);
  }

  const worktreePath = path.join(rootDir, "worktrees", input.id);
  const liveEnabled = input.live === true;

  if (liveEnabled) {
    const repoRoot = path.resolve(input.repoRoot ?? process.cwd());
    const baseRef = input.baseRef ?? "origin/main";
    const sessionName = input.sessionName ?? `swarm-${sanitizeSessionName(input.id)}`;
    const agentCommand = input.agentCommand ?? "echo agent-start && sleep 1";
    runOrThrow(
      runCommand,
      "git",
      ["worktree", "add", worktreePath, "-b", input.branch, baseRef],
      { cwd: repoRoot }
    );
    runOrThrow(
      runCommand,
      "tmux",
      ["new-session", "-d", "-s", sessionName, "-c", worktreePath, agentCommand],
      { cwd: repoRoot }
    );
  } else {
    ensureDir(worktreePath);
  }

  const task = {
    id: input.id,
    title: input.title,
    repo: input.repo,
    branch: input.branch,
    agent: input.agent,
    mode: liveEnabled ? "live" : "local",
    status: "running",
    retries: 0,
    maxRetries: input.maxRetries ?? 3,
    notifyOnComplete: input.notifyOnComplete !== false,
    requireReview: input.requireReview === true,
    requireScreenshot: input.requireScreenshot === true,
    worktreePath,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (liveEnabled) {
    task.live = {
      enabled: true,
      repoRoot: path.resolve(input.repoRoot ?? process.cwd()),
      baseRef: input.baseRef ?? "origin/main",
      baseBranch: deriveBaseBranch(input.baseRef ?? "origin/main"),
      sessionName: input.sessionName ?? `swarm-${sanitizeSessionName(input.id)}`,
      agentCommand: input.agentCommand ?? "echo agent-start && sleep 1"
    };
  }

  registry.tasks.push(task);
  writeRegistry(rootDir, registry);
  return task;
}

export function runCheckCycle(rootDir, options = {}) {
  ensureProject(rootDir);
  const registry = readRegistry(rootDir);
  const runCommand = getRunner(options);
  const result = { ready: 0, retried: 0, failed: 0, unchanged: 0 };

  for (const task of registry.tasks) {
    if (TERMINAL_STATUSES.has(task.status)) {
      result.unchanged += 1;
      continue;
    }

    if (task.status === "ready") {
      result.unchanged += 1;
      continue;
    }

    let checks;
    let retryableFailure = false;
    let note;
    let pr;

    if (task.live?.enabled === true) {
      const liveResult = evaluateLiveTask(task, runCommand);
      checks = liveResult.checks;
      retryableFailure = liveResult.retryableFailure === true;
      note = liveResult.note;
      pr = liveResult.pr;
    } else {
      const evidence = readEvidence(rootDir, task.id);
      if (!evidence) {
        result.unchanged += 1;
        continue;
      }
      checks = normalizeChecks(evidence);
      retryableFailure = evidence.retryableFailure === true;
      note = evidence.note;
    }

    task.checks = checks;
    task.updatedAt = nowIso();
    if (typeof note === "string" && note.length > 0) {
      task.note = note;
    }
    if (pr) {
      task.pr = pr;
    }

    if (checksPassed(checks)) {
      task.status = "ready";
      result.ready += 1;
      continue;
    }

    if (retryableFailure) {
      if (task.retries < task.maxRetries) {
        task.retries += 1;
        task.status = "running";
        result.retried += 1;
      } else {
        task.status = "failed";
        result.failed += 1;
      }
      continue;
    }

    result.unchanged += 1;
  }

  writeRegistry(rootDir, registry);
  return result;
}

export function notifyReadyTasks(rootDir) {
  ensureProject(rootDir);
  const registry = readRegistry(rootDir);
  const lines = [];
  let sent = 0;

  for (const task of registry.tasks) {
    if (task.status !== "ready") {
      continue;
    }
    if (task.notifyOnComplete !== true || task.notifiedAt) {
      continue;
    }
    task.notifiedAt = nowIso();
    task.updatedAt = nowIso();
    sent += 1;
    lines.push(
      JSON.stringify({
        at: task.notifiedAt,
        taskId: task.id,
        title: task.title,
        branch: task.branch,
        prUrl: task.pr?.url ?? "",
        message: `PR ready for review: ${task.id}`
      })
    );
  }

  if (lines.length > 0) {
    fs.appendFileSync(notificationLogPath(rootDir), `${lines.join("\n")}\n`, "utf8");
  }

  writeRegistry(rootDir, registry);
  return { sent };
}

export function sendInstruction(rootDir, taskId, text, options = {}) {
  ensureProject(rootDir);
  const registry = readRegistry(rootDir);
  const runCommand = getRunner(options);
  const task = findTaskOrThrow(registry, taskId);
  ensureLiveTask(task);

  runOrThrow(
    runCommand,
    "tmux",
    ["send-keys", "-t", task.live.sessionName, text, "Enter"],
    { cwd: task.live.repoRoot }
  );
  task.updatedAt = nowIso();
  writeRegistry(rootDir, registry);
  return { sent: true };
}

export function createPullRequest(rootDir, taskId, options = {}) {
  ensureProject(rootDir);
  const registry = readRegistry(rootDir);
  const runCommand = getRunner(options);
  const task = findTaskOrThrow(registry, taskId);
  ensureLiveTask(task);

  const result = runOrThrow(
    runCommand,
    "gh",
    [
      "pr",
      "create",
      "--fill",
      "--head",
      task.branch,
      "--base",
      task.live.baseBranch || deriveBaseBranch(task.live.baseRef || "origin/main")
    ],
    { cwd: task.worktreePath }
  );
  const url = extractUrlFromText(result.stdout.trim());
  task.pr = {
    ...(task.pr ?? {}),
    url
  };
  task.updatedAt = nowIso();
  writeRegistry(rootDir, registry);
  return { url };
}

export function cleanupTasks(rootDir, maxAgeHours = 24, options = {}) {
  ensureProject(rootDir);
  const registry = readRegistry(rootDir);
  const runCommand = getRunner(options);
  const now = Date.now();
  const kept = [];
  let removed = 0;

  for (const task of registry.tasks) {
    const updatedAtMs = Date.parse(task.updatedAt);
    const ageMs = Number.isNaN(updatedAtMs) ? Number.POSITIVE_INFINITY : now - updatedAtMs;
    const shouldRemove = TERMINAL_STATUSES.has(task.status) && ageMs >= maxAgeHours * 60 * 60 * 1000;

    if (!shouldRemove) {
      kept.push(task);
      continue;
    }

    removed += 1;
    if (task.live?.enabled) {
      runCommand("tmux", ["kill-session", "-t", task.live.sessionName], { cwd: task.live.repoRoot });
      runCommand("git", ["worktree", "remove", "--force", task.worktreePath], {
        cwd: task.live.repoRoot
      });
    }
    if (typeof task.worktreePath === "string" && task.worktreePath.length > 0) {
      fs.rmSync(task.worktreePath, { recursive: true, force: true });
    }
  }

  registry.tasks = kept;
  writeRegistry(rootDir, registry);
  return { removed };
}
