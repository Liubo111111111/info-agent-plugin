---
name: url-to-markdown
description: "网页内容提取并转换为 Markdown。当用户需要：(1) 提取 X/Twitter 文章或推文，(2) 提取 ChatGPT/Gemini/Grok 对话，(3) 将任意网页转为 Markdown，(4) 调试网页结构进行内容提取"
allowed-tools: Bash, mcp__playwright__browser_navigate, mcp__playwright__browser_wait_for, mcp__playwright__browser_snapshot, mcp__playwright__browser_evaluate, mcp__playwright__browser_console_messages
---

# Web Content to Markdown Extractor

## 概述

使用三层策略从网页提取内容并转换为 Markdown：

| 层级 | 方法 | 速度 | 适用场景 |
|------|------|------|----------|
| 1 | Jina Reader | 最快 | 大多数公开网页 |
| 2 | 专用脚本 | 快 | 特定平台优化 |
| 3 | Playwright | 慢 | 需要登录/复杂交互 |

## 工作流程决策树

### 公开网页
→ 使用 Jina Reader（Tier 1）

### X/Twitter 内容
→ 先尝试专用脚本（Tier 2），失败则用 Playwright

### 需要登录的页面（ChatGPT/Gemini/Grok）
→ 直接使用 Playwright（Tier 3）

### 提取失败
→ 使用调试脚本查找正确选择器

## Tier 1: Jina Reader（首选）

Jina Reader 可直接将 URL 转为 Markdown，免费无需 API key。

```bash
# 使用脚本
node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fetch-jina.js "<URL>"

# 或直接 curl
curl -s "https://r.jina.ai/<URL>"
```

**优点**: 自动处理 JS 渲染，直接返回干净 Markdown

## Tier 2: 平台专用脚本

当 Jina 失败或需要特定格式时：

```bash
# X/Twitter（使用 Syndication API）
node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fetch-x.js "<URL>"

# 通用网页（直接 HTTP）
node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fetch-generic.js "<URL>"
```

## 保存文件最佳实践

**重要**: 使用 Node.js 保存文件，避免 PowerShell 编码问题：

```bash
# 正确方式：使用 Node.js 保存（避免乱码）
node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fetch-jina.js "<URL>" > temp.json
node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync('temp.json','utf8'));fs.writeFileSync('output/filename.md',data.markdown,'utf8');"

# 错误方式：PowerShell 重定向（可能产生乱码）
# ... | Out-File -Encoding utf8 output.md  ❌
```

## 编码修复

如果文件已存在乱码（如 `鈥檛` 等），使用修复脚本：

```bash
node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fix-encoding.js "<file_path>"
```

**常见乱码来源**:
- PowerShell 输出重定向的编码问题（主要原因）
- UTF-8 BOM 问题

## Tier 3: Playwright（兜底）

当以上方法都失败时（需要登录、反爬严格）：

```javascript
// 1. 导航
mcp__playwright__browser_navigate(url: "<URL>")

// 2. 等待加载
mcp__playwright__browser_wait_for(time: 3)

// 3. 验证页面
mcp__playwright__browser_snapshot()

// 4. 提取内容
mcp__playwright__browser_evaluate(function: "<extractor>")
```

**强制要求**：使用 Playwright 提取前，完整阅读 [`references/playwright-extractors.md`](references/playwright-extractors.md) 了解各平台的提取器代码。

## 支持的平台

| 平台 | URL 模式 | 内容类型 | 推荐方法 |
|------|----------|----------|----------|
| X/Twitter | `x.com/*`, `twitter.com/*` | 文章、推文 | Tier 2 脚本 |
| ChatGPT | `chat.openai.com/*`, `chatgpt.com/*` | 对话 | Tier 3 Playwright |
| Gemini | `gemini.google.com/*` | 对话 | Tier 3 Playwright |
| Grok | `grok.x.ai/*`, `x.com/i/grok/*` | 对话 | Tier 3 Playwright |
| 其他 | 任意 URL | 通用提取 | Tier 1 Jina |

## 输出格式

### 文章格式

```markdown
# {title}

**作者**: [@{author}](https://x.com/{author})
**日期**: {date}
**链接**: {url}

---

{content}
```

### 对话格式

```markdown
# {platform} Conversation

**链接**: {url}

---

## User
{user message}

## Assistant
{assistant message}
```

## 调试

提取失败时：

1. `mcp__playwright__browser_snapshot()` 查看页面结构
2. `mcp__playwright__browser_console_messages()` 检查错误
3. 使用调试脚本查找可用选择器（见 references/playwright-extractors.md）

## EXTEND 支持

若当前目录存在 `EXTEND.md`，先读取该文件并将其作为提取策略补充规则。

## Human Checkpoints

在以下关键环节暂停，等待用户确认后再继续：

| 环节 | 触发条件 | 用户操作 | 为什么需要 |
|------|----------|----------|------------|
| 🔐 登录处理 | 检测到登录页 | 手动登录后确认 | 无法自动处理认证 |
| 🔧 选择器调整 | 提取失败 | 查看页面结构，提供选择器 | 网站结构变化 |
| 📄 内容确认 | 提取完成 | 预览 Markdown，确认质量 | 确保提取完整性 |

### Checkpoint 1: 登录处理

检测到需要登录时：
```
⚠️ 检测到登录页面

请在浏览器中手动登录，完成后输入 'done' 继续。

提示：登录后页面会自动刷新，等待内容加载完成再继续。
```

### Checkpoint 2: 选择器调整

提取失败时，展示调试信息：
```
❌ 默认选择器未找到内容

页面结构分析：
- data-testid 属性: {list}
- 有 main 标签: {yes/no}
- 有 article 标签: {yes/no}

请提供正确的 CSS 选择器，或输入 'skip' 跳过。
```

### Checkpoint 3: 内容确认

提取成功后：
```
✅ 提取完成

- 标题: {title}
- 字数: {word_count}
- 图片: {image_count} 张

预览：
{first_300_chars}...

确认保存？[Y/n/edit]
```

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| 页面未加载 | 增加 wait_for 时间 |
| 需要登录 | 让用户先手动登录 |
| 选择器失效 | 使用调试脚本查找正确选择器 |
| 内容在 iframe | 需要切换到 iframe 上下文 |

