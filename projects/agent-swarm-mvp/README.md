# agent-swarm-mvp

Minimal local orchestration project for one-person agent workflow.

## What it includes

- File-based task registry (`registry/active-tasks.json`)
- Commands for `spawn`, `check`, `notify`, `cleanup`
- Live mode commands for `send` and `pr-create`
- Evidence-driven status transitions (from `registry/evidence/<taskId>.json`)
- Notification log output (`output/notifications.log`)

## Quick start

```bash
npm run swarm:mvp -- init
```

Create a task:

```bash
npm run swarm:mvp -- spawn \
  --id feat-custom-templates \
  --title "Custom templates" \
  --repo medialyst \
  --branch feat/custom-templates \
  --agent codex \
  --max-retries 2
```

Add check evidence:

```json
{
  "checks": {
    "prCreated": true,
    "ciPassed": true,
    "reviewPassed": true,
    "uiScreenshotIncluded": true
  }
}
```

Save the JSON to:

```text
projects/agent-swarm-mvp/runtime/registry/evidence/feat-custom-templates.json
```

Run check cycle:

```bash
npm run swarm:mvp -- check
```

Send ready notifications:

```bash
npm run swarm:mvp -- notify
```

Cleanup old terminal tasks:

```bash
npm run swarm:mvp -- cleanup --max-age-hours 24
```

## Live mode (git worktree + tmux + gh)

Prerequisites:

- `git`
- `tmux`
- `gh` (already authenticated to your GitHub account)

Spawn a live task:

```bash
npm run swarm:mvp -- spawn \
  --id feat-live-pr \
  --title "Live PR flow" \
  --repo info-agent-plugin \
  --branch feat/live-pr \
  --agent codex \
  --live \
  --repo-root . \
  --base-ref origin/main \
  --session-name codex-live-pr \
  --agent-command "codex --model gpt-5.3-codex -c model_reasoning_effort=high \"Implement task\""
```

Send mid-task instruction to tmux session:

```bash
npm run swarm:mvp -- send --id feat-live-pr --text "Focus API first, then tests."
```

Create PR via gh:

```bash
npm run swarm:mvp -- pr-create --id feat-live-pr
```

Check live PR status (PR exists, CI, reviews, screenshot rule):

```bash
npm run swarm:mvp -- check
```

## Command reference

```text
node projects/agent-swarm-mvp/src/cli.js init [--root <dir>]
node projects/agent-swarm-mvp/src/cli.js spawn --id <id> --title <title> --repo <repo> --branch <branch> --agent <agent> [--max-retries <n>] [--live] [--repo-root <dir>] [--base-ref <ref>] [--session-name <name>] [--agent-command <cmd>] [--require-review] [--require-screenshot] [--root <dir>]
node projects/agent-swarm-mvp/src/cli.js check [--root <dir>]
node projects/agent-swarm-mvp/src/cli.js notify [--root <dir>]
node projects/agent-swarm-mvp/src/cli.js send --id <id> --text <message> [--root <dir>]
node projects/agent-swarm-mvp/src/cli.js pr-create --id <id> [--root <dir>]
node projects/agent-swarm-mvp/src/cli.js cleanup [--max-age-hours <n>] [--root <dir>]
```
