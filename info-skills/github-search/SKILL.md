---
name: github-search
description: "根据主题搜索 GitHub 上的开源项目，自动提取项目信息（Star、描述、语言等），并生成结构化报告。支持预定义主题和自定义关键词搜索。"
allowed-tools: Read, Write, Shell(node*), Shell(mkdir*)
---

# GitHub 项目搜索

根据用户提供的主题搜索 GitHub 上的开源项目，自动获取项目详情并生成结构化报告。

## 内容抓取策略

**重要**：本 skill 使用统一的 Content Fetcher 模块进行内容抓取，参考 [`../../_shared/content-fetcher.md`](../../_shared/content-fetcher.md)。

**抓取优先级**：
1. **Jina Reader**（首选）：免费、快速、自动处理 JS 渲染
2. **Playwright MCP**（回退）：当 Jina 失败时自动回退

## 格式规范

**重要**：本 skill 遵循统一输出格式规范，详见 [`../../_shared/format-spec.md`](../../_shared/format-spec.md)。

## 不适用场景

- 搜索私有仓库（需要登录认证）
- 实时监控 GitHub 趋势（本 skill 为单次搜索）
- 代码级别的搜索（本 skill 搜索仓库，非代码内容）

## 如何启动

用户可以通过以下方式触发此 skill：

```
搜索 GitHub 上的 AI Agent 框架
帮我找找 RAG 相关的开源项目
GitHub 搜索：MCP Server
有什么好的 LLM 工具推荐吗？（GitHub）
```

## 步骤 0：前置检查

1. **检查配置文件**：验证 [`config.json.example`](config.json.example) 是否存在
2. **检查输出目录**：确认 `output_info/` 目录存在，如不存在则创建
3. **检查缓存文件**：读取 [`cache.json.example`](cache.json.example) 了解搜索历史
4. 如果 `config.json` 缺失：从 [`config.json.example`](config.json.example) 复制并填写

## 步骤 1：确定搜索主题

### 主题来源

1. **预定义主题**：从 `config.json` 的 `predefined_topics` 中选择
2. **自定义主题**：用户直接输入关键词
3. 若存在 `EXTEND.md`，读取并将其作为补充执行规则

### 预定义主题列表

从 [`config.json.example`](config.json.example) 读取，包括：ai_agent, llm_tools, rag, mcp, code_assistant, prompt_engineering, vector_db, fine_tuning

## 步骤 2：构造搜索 URL 并使用 Content Fetcher 抓取

### GitHub 搜索 URL 格式

```
https://github.com/search?q={keywords}&type=repositories&s=stars&o=desc
```

### 执行搜索（使用 Content Fetcher）

```bash
# 1. 首先尝试 Jina Reader
node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fetch-jina.js "搜索URL"

# 2. 如果失败或内容不足，执行 Playwright MCP 回退
```

### 抓取方法记录

在报告元数据中记录使用的抓取方法（jina/playwright）和回退原因。

## 步骤 3：提取搜索结果列表

从搜索结果页面提取 Top 10 项目：name, description, stars, language, url

## 步骤 4：查看 Top N 项目详情

使用 Content Fetcher 获取每个项目页面，提取详细信息。

### 容错处理

**单个项目抓取失败时**：
1. 记录失败的项目和错误原因到日志
2. 继续处理其他项目（不中断整体流程）
3. 在报告中标注未能获取详情的项目

## 步骤 5：生成评分

根据 Star 数量和活跃度计算 1-5 分评分。

## 步骤 6：生成报告

输出路径：`GithubSearch/YYYY-MM-DD-{topic_id}.md`

报告包含：
- 搜索关键词和抓取统计
- Top 5 项目详情（含抓取方法标注）
- 其他推荐项目表格
- 抓取统计表格

## 步骤 7：更新缓存

更新 [`cache.json.example`](cache.json.example) 包含搜索历史和抓取统计。

## 步骤 8：展示结果

向用户展示：项目数量、抓取统计、报告链接。

## 失败处理

- **搜索页面抓取失败**：Jina 失败自动回退到 Playwright
- **项目详情页失败**：记录错误，继续处理其他项目
- **搜索结果不足**：提示用户扩展关键词

## 约束与原则

1. **Jina 优先**：始终先尝试 Jina Reader
2. **容错处理**：单个项目失败不影响整体流程
3. **抓取标注**：在报告中标注每个项目使用的抓取方法

## 依赖项

- **Content Fetcher 模块**：[`../../_shared/content-fetcher.md`](../../_shared/content-fetcher.md)
- **Jina Reader 脚本**：[`../../utility-skills/url-to-markdown/scripts/fetch-jina.js`](../../utility-skills/url-to-markdown/scripts/fetch-jina.js)
- **Playwright MCP**：浏览器回退方案








