# info-agent-plugin

Info Agent Plugin for collecting, filtering, and organizing high-quality technical information from Hacker News, GitHub, X, and other sources.

信息搜集插件：从 Hacker News、GitHub、X 等来源抓取并整理高质量技术内容。

## Plugin Overview | 插件概述

- Grouped skill architecture: `info-skills` + `utility-skills`
- Shared modules under `_shared/`
- Config templates with `.example` files
- User customization via `EXTEND.md`

## Directory Structure | 目录结构

```text
info-agent-plugin/
├── plugin.json
├── README.md
├── .env.example
├── .gitignore
├── info-skills/
│   ├── daily-news-report/
│   ├── x-digest/
│   ├── github-search/
│   └── info-collector/
├── utility-skills/
│   ├── url-to-markdown/
│   └── notion-sync/
└── _shared/
```

## Installation | 安装

```bash
npx skills add <github-user>/info-agent-plugin
```

After install, create project-level env file:

```bash
cp .info-agent-plugin/.env.example .info-agent-plugin/.env
```

Windows PowerShell:

```powershell
Copy-Item .info-agent-plugin/.env.example .info-agent-plugin/.env
```

## Environment Variables | 环境变量配置

Required / 必填:
- `NOTION_API_KEY`
- `NOTION_PARENT_PAGE_ID`
- `NOTION_DATABASE_ID`

Optional / 可选:
- `X_LIST_URL_1`
- `JINA_API_KEY`

Priority / 优先级:
1. Process env
2. Project: `.info-agent-plugin/.env`
3. User: `~/.info-agent-plugin/.env`

## Skill Usage Examples | Skill 使用示例

- `daily-news-report`: `生成今日新闻报告`
- `x-digest`: `生成今日 X AI 摘要`
- `github-search`: `搜索 GitHub 上的 MCP Server`
- `info-collector`: `每日信息汇总`
- `url-to-markdown`: `将这个 URL 转成 Markdown`
- `notion-sync`: `同步今日新闻到 Notion`

## EXTEND.md Customization Guide | EXTEND.md 自定义指南

Each skill supports optional `EXTEND.md` in its own directory.

每个 skill 目录都支持可选 `EXTEND.md`，用于添加自定义规则，不会被插件更新覆盖。

Steps:
1. Copy `EXTEND.md.example` to `EXTEND.md`
2. Add custom rules
3. Run the skill normally

## Migration Guide | 从 .claude/skills 迁移

1. Copy your old runtime files into the new plugin folders:
- `sources.json`
- `config.json`
- `cache.json`
- `sync-history.json`

2. Move secrets into `.info-agent-plugin/.env`.

3. Update custom scripts/paths from:
- `.claude/skills/<skill>/...`

to:
- `.info-agent-plugin/info-skills/<skill>/...`
- `.info-agent-plugin/utility-skills/<skill>/...`

4. Keep user customization in `EXTEND.md` instead of editing `SKILL.md`.
