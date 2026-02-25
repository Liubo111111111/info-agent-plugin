#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {
  cleanupTasks,
  createPullRequest,
  ensureProject,
  notifyReadyTasks,
  runCheckCycle,
  sendInstruction,
  spawnTask
} from "./orchestrator.js";

function printUsage() {
  console.log(`agent-swarm-mvp

Usage:
  node projects/agent-swarm-mvp/src/cli.js init [--root <dir>]
  node projects/agent-swarm-mvp/src/cli.js spawn --id <id> --title <title> --repo <repo> --branch <branch> --agent <agent> [--max-retries <n>] [--live] [--repo-root <dir>] [--base-ref <ref>] [--session-name <name>] [--agent-command <cmd>] [--require-review] [--require-screenshot] [--root <dir>]
  node projects/agent-swarm-mvp/src/cli.js check [--root <dir>]
  node projects/agent-swarm-mvp/src/cli.js notify [--root <dir>]
  node projects/agent-swarm-mvp/src/cli.js send --id <id> --text <message> [--root <dir>]
  node projects/agent-swarm-mvp/src/cli.js pr-create --id <id> [--root <dir>]
  node projects/agent-swarm-mvp/src/cli.js cleanup [--max-age-hours <n>] [--root <dir>]
`);
}

function parseArgs(rawArgs) {
  const options = {};
  const positionals = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const token = rawArgs[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = rawArgs[i + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    i += 1;
  }
  return { options, positionals };
}

function getRootDir(options) {
  if (typeof options.root === "string" && options.root.length > 0) {
    return path.resolve(options.root);
  }
  return path.resolve(process.cwd(), "projects", "agent-swarm-mvp", "runtime");
}

function requireOption(options, key, positionalValue) {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    if (typeof positionalValue === "string" && positionalValue.length > 0) {
      return positionalValue;
    }
    throw new Error(`Missing required option: --${key}`);
  }
  return value;
}

function toInteger(rawValue, fallback) {
  if (typeof rawValue !== "string") {
    return fallback;
  }
  const n = Number.parseInt(rawValue, 10);
  if (Number.isNaN(n)) {
    return fallback;
  }
  return n;
}

function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "help" || command === "--help") {
    printUsage();
    process.exit(0);
  }

  const parsed = parseArgs(rest);
  const options = parsed.options;
  const positionals = parsed.positionals;
  const rootDir = getRootDir(options);

  if (command === "init") {
    ensureProject(rootDir);
    console.log(`initialized runtime at ${rootDir}`);
    process.exit(0);
  }

  if (command === "spawn") {
    const spawnPositional = positionals;
    const task = spawnTask(rootDir, {
      id: requireOption(options, "id", spawnPositional[0]),
      title: requireOption(options, "title", spawnPositional[1]),
      repo: requireOption(options, "repo", spawnPositional[2]),
      branch: requireOption(options, "branch", spawnPositional[3]),
      agent: requireOption(options, "agent", spawnPositional[4]),
      maxRetries: toInteger(options["max-retries"] ?? spawnPositional[5], 3),
      notifyOnComplete: options["no-notify"] !== true,
      live: options.live === true || options.mode === "live",
      repoRoot: typeof options["repo-root"] === "string" ? options["repo-root"] : undefined,
      baseRef: typeof options["base-ref"] === "string" ? options["base-ref"] : undefined,
      sessionName:
        typeof options["session-name"] === "string" ? options["session-name"] : undefined,
      agentCommand:
        typeof options["agent-command"] === "string" ? options["agent-command"] : undefined,
      requireReview: options["require-review"] === true,
      requireScreenshot: options["require-screenshot"] === true
    });
    console.log(`spawned task ${task.id}`);
    process.exit(0);
  }

  if (command === "check") {
    const result = runCheckCycle(rootDir);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === "notify") {
    const result = notifyReadyTasks(rootDir);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === "send") {
    const taskId = requireOption(options, "id", positionals[0]);
    const text = requireOption(options, "text", positionals[1]);
    const result = sendInstruction(rootDir, taskId, text);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === "pr-create") {
    const taskId = requireOption(options, "id", positionals[0]);
    const result = createPullRequest(rootDir, taskId);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === "cleanup") {
    const result = cleanupTasks(rootDir, toInteger(options["max-age-hours"], 24));
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  printUsage();
  process.exit(1);
}

main();
