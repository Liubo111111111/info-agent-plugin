---
name: notion-sync
description: "将 daily-news-report 生成的 Markdown 报告解析并同步到 Notion 数据库。支持自动创建数据库、去重、结构化字段映射。"
allowed-tools: Read, Write, Bash, user-Notion-*
---

# Notion Sync

将 `daily-news-report` 生成的每日新闻报告自动同步到 Notion 数据库，支持智能去重和结构化存储。

## 快速开始

### 方式一：使用 Python 脚本（推荐）

```bash
# 同步今日报告
python .info-agent-plugin/utility-skills/notion-sync/scripts/sync.py

# 同步指定日期报告
python .info-agent-plugin/utility-skills/notion-sync/scripts/sync.py 2026-01-26
```

### 方式二：Agent 调用

```
同步今日新闻到 Notion
同步 2026-01-22 的新闻到 Notion
将今日报告同步到 Notion
```

## 前置配置

### 1. 环境变量

优先在项目级 `.info-agent-plugin/.env` 配置（可回退到 `~/.info-agent-plugin/.env`）：

```env
NOTION_API_KEY=ntn_xxxxx
NOTION_PARENT_PAGE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 2. Notion Integration 权限

1. 访问 https://www.notion.so/my-integrations 创建 Integration
2. 复制 API Token 到 `.info-agent-plugin/.env`
3. 在 Notion 中打开目标页面
4. 点击右上角 `···` → `Connections` → 添加你的 Integration

### 3. 数据库配置

复制 [`config.json.example`](config.json.example) 为 `config.json` 后编辑：

```json
{
  "parent_page_id": "页面 ID",
  "database_id": "数据库 ID（与 Integration 共享的数据库）",
  "database_name": "Daily News Archive",
  "created_at": "2026-01-23"
}
```

### 4. 安装依赖

```bash
pip install python-dotenv requests
```

## 数据库 Schema

| 字段名 | Notion 类型 | 说明 |
|--------|-------------|------|
| Title | Title | 文章标题（必需） |
| Summary | Rich Text | 摘要（2-4句） |
| KeyPoints | Rich Text | 要点列表 |
| URL | URL | 原文链接 |
| Keywords | Multi-select | 关键词标签 |
| Score | Select | 评分（1-5） |
| Source | Select | 来源（HN, HF Papers 等） |
| ReportDate | Date | 报告日期 |
| Rank | Number | 当日排名（1-20） |

## 工作流程

```
1. 读取 output_info/YYYY-MM-DD-news-report.md
2. 解析 Markdown 提取文章结构
3. 检查 sync-history.json 去重
4. 调用 Notion API 创建页面
5. 更新同步历史
```

## 配置文件

| 文件 | 用途 |
|------|------|
| [`config.json.example`](config.json.example) | 数据库配置 |
| [`sync-history.json.example`](sync-history.json.example) | 同步历史、已同步 URL |
| [`scripts/sync.py`](scripts/sync.py) | 同步脚本 |

如果 `config.json` 缺失：从 [`config.json.example`](config.json.example) 复制并填写。
如果 `sync-history.json` 缺失：脚本首次运行会自动创建。

## 脚本功能

[`scripts/sync.py`](scripts/sync.py) 提供以下功能：

- ✅ 自动解析 Markdown 报告
- ✅ URL 去重（基于 sync-history.json）
- ✅ 批量同步到 Notion
- ✅ 网络重试机制（3 次重试）
- ✅ 数据库访问验证
- ✅ 同步历史更新

### 使用示例

```bash
# 同步今日报告
python .info-agent-plugin/utility-skills/notion-sync/scripts/sync.py

# 同步指定日期
python .info-agent-plugin/utility-skills/notion-sync/scripts/sync.py 2026-01-25

# 查看帮助
python .info-agent-plugin/utility-skills/notion-sync/scripts/sync.py --help
```

### 输出示例

```
🔍 Verifying database access...
✅ Database: Daily News Archive
📰 Parsing report: output_info/2026-01-26-news-report.md
✅ Found 20 articles
🆕 New articles to sync: 20
[1/20] Syncing: ICE 使用 Palantir 工具采集医疗补助金数据...
  ✅ Success
[2/20] Syncing: Clawdbot - 开源个人 AI 助手...
  ✅ Success
...

📊 Sync Summary:
  ✅ Success: 20
  ❌ Failed: 0
```

## 故障排除

### Q: 报错 "NOTION_API_KEY not set"
A: 检查 `.info-agent-plugin/.env` 或 `~/.info-agent-plugin/.env` 是否存在且包含 `NOTION_API_KEY=ntn_xxx`

### Q: 报错 "Database not found"
A: 确保 Integration 已添加到 Notion 数据库页面的 Connections 中

### Q: 报错 "Could not find database with ID"
A: 检查 `config.json` 中的 `database_id` 是否正确（带连字符格式）

### Q: 网络超时
A: 脚本会自动重试 3 次，如持续失败请检查网络连接

## 约束与原则

1. **增量同步**：只添加新记录，不删除或修改已有记录
2. **去重优先**：基于 URL 严格去重
3. **错误容错**：单条失败不影响整体流程
4. **历史持久化**：同步记录保存到 sync-history.json
5. **扩展优先**：若存在 `EXTEND.md`，其指令作为同步补充规则

## 依赖项

- Python 3.8+
- python-dotenv
- requests
- daily-news-report skill（依赖其生成的报告格式）



