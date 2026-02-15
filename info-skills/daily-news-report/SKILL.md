---
name: daily-news-report
description: "从多个高质量技术信息源（HN 热帖、HN 顶级博客 RSS、HuggingFace Papers 等）抓取内容，AI 三维评分+六大分类，生成结构化每日 Markdown 报告。"
allowed-tools: Task, WebFetch, Read, Write, Shell(mkdir*), user-Notion-*
---

# Daily News Report v3.0

从 Hacker News 热帖、HN 社区顶级技术博客 RSS、HuggingFace Papers 等高质量源抓取内容，通过三维评分筛选，按六大分类生成结构化每日报告。

## v3.0 更新要点

| 特性 | v2.x | v3.0 |
|------|------|------|
| HN 信息源 | 仅首页热帖 | 首页热帖 + 20 个顶级博客 RSS |
| 评分体系 | 1-5 简单评分 | 三维评分（相关性/质量/时效） |
| 内容分类 | 无 | 六大分类自动归类 |
| 报告结构 | 平铺列表 | 今日看点→必读→分类展示→数据概览 |
| 博客摘要 | 无 | 4-6 句结构化摘要 + 中英双语标题 |

## 共享规范

| 模块 | 用途 |
|------|------|
| [`../../_shared/format-spec.md`](../../_shared/format-spec.md) | 输出格式规范（v3.0） |
| [`../../_shared/hn-fetcher.md`](../../_shared/hn-fetcher.md) | HN 双通道抓取规范 |
| [`../../_shared/browser-utils.md`](../../_shared/browser-utils.md) | 浏览器抓取工具 |
| [`../../_shared/dedup-scoring.md`](../../_shared/dedup-scoring.md) | 去重与评分逻辑 |
| [`../../_shared/cache-schema.json`](../../_shared/cache-schema.json) | 缓存文件 Schema |

## 如何启动

```
生成今日新闻报告
生成 2026-02-15 的新闻报告
```

## 步骤 0：前置检查

验证配置文件存在（skill 目录：`.info-agent-plugin/info-skills/daily-news-report/`）：
- `sources.json` - 信息源配置（v3.0 含 RSS 博客列表和分类体系）
- `cache.json` - 缓存数据

如果 `sources.json` 缺失：从 [`sources.json.example`](sources.json.example) 复制并填写。
如果 `cache.json` 缺失：初始化为空缓存文件。

## 步骤 1：初始化

1. **强制要求 - 阅读配置**：完整阅读 [`sources.json.example`](sources.json.example) 了解源配置
2. 确定目标日期（用户参数或当前日期，格式：`YYYY-MM-DD`）
3. 创建输出目录 `output_info/`（如不存在）
4. 读取 [`cache.json.example`](cache.json.example) 检查历史数据，避免重复收录
5. 若存在 `EXTEND.md`，读取并将其作为补充执行规则

## 步骤 1.5：日期过滤（重要）

**在并行抓取时，必须将当前日期传递给每个 subagent**。

| 源 | 时间窗口 | 说明 |
|---|---|---|
| HN 首页 | 24-48 小时 | HN 内容更新快，只取最新 |
| HN 博客 RSS | 72 小时 | 博客更新频率低，适当放宽 |
| HuggingFace Papers | 7 天内 | 论文编号 `YYMM.xxxxx` 需验证 |
| Paul Graham | 最新 3-5 篇 | PG 文章少，按时间倒序取最新 |
| 博客类源 | 7 天内 | 检查文章发布日期 |

## 步骤 2：分批抓取（三通道并行）

### 抓取策略路由（v3.0）

| 优先级 | 源类型 | 抓取方法 | 说明 |
|--------|--------|----------|------|
| 1A | HN 首页热帖 | WebFetch | 通道 A：Top 15 热帖 |
| 1B | HN 顶级博客 RSS | Jina Reader / WebFetch | 通道 B：20 个博客 RSS 并发抓取 |
| 1C | HF Papers + PG + OneUsefulThing | WebFetch | 其他 Tier1 源 |
| 2 | Tier2 (James Clear, FS Blog) | WebFetch | 按需补充 |
| 3 | Tier3 Browser (ProductHunt) | WebFetch（可能不完整） | 需要 JS 渲染 |
| — | **停止** | — | 高质量 >= 25 条时早停 |

### 通道 B：RSS 博客批量抓取（新增）

按照 [`../../_shared/hn-fetcher.md`](../../_shared/hn-fetcher.md) 的通道 B 规范执行：

```
1. 从 sources.json 读取 tier1_hn_blogs.feeds（enabled=true）
2. 并发抓取所有 RSS URL（10 路并发，15s 超时）
3. 解析 RSS/Atom，提取文章列表
4. 按 72 小时时间窗口过滤
5. 每个 feed 最多取 3 篇
6. 合并后上限 30 篇
7. 对每篇文章：
   - 生成中文翻译标题
   - 生成 4-6 句结构化摘要
   - 三维评分（相关性/质量/时效）
   - 自动归入六大分类
```

### SubAgent 任务格式（v3.0 含分类和三维评分）

```python
{
  "current_date": "2026-02-15",
  "task": "fetch_and_extract",
  "sources": [
    {"id": "hn", "url": "https://news.ycombinator.com", "extract": "top_15"}
  ],
  "output_schema": {
    "source_id": "string",
    "title": "string",
    "title_zh": "string (中文翻译，博客源必需)",
    "summary": "string (2-4句，博客源 4-6 句)",
    "key_points": "string[] (最多3个)",
    "url": "string",
    "keywords": "string[] (3个关键词)",
    "category": "string (六大分类 ID)",
    "scores": {
      "relevance": "1-10",
      "quality": "1-10",
      "timeliness": "1-10"
    },
    "final_score": "1-5 (三维加权映射)",
    "pub_date": "发布日期"
  },
  "categories": ["ai_ml", "security", "engineering", "tools_oss", "opinions", "other"],
  "return_format": "JSON"
}
```

## 步骤 3：评估与筛选（v3.0 三维评分）

按照 [`../../_shared/dedup-scoring.md`](../../_shared/dedup-scoring.md) 规范执行去重和评分。

### 三维评分计算

```
weighted_score = relevance * 0.4 + quality * 0.35 + timeliness * 0.25
final_star = round(weighted_score / 2)  # 映射到 1-5 星
```

### 来源权重加成

| 来源 | 权重加成 |
|------|----------|
| HN 首页 (>300 pts) | relevance +1 |
| HN 顶级博客 (rank 1-5) | quality +1 |
| HF Papers (>50 likes) | relevance +1 |
| Tier2 源 | 无加成 |

### 排序与截取

1. 按 `final_score` 降序
2. 同分按热度/三维加权分降序
3. 同热度按时间降序
4. **截取 Top 25**
5. 从 Top 25 中选出 **Top 3 作为「今日必读」**

## 步骤 4：生成报告（v3.0 新结构）

输出路径：`output_info/YYYY-MM-DD-news-report.md`

### 报告结构

遵循 [`../../_shared/format-spec.md`](../../_shared/format-spec.md) v3.0 格式：

```markdown
# Daily News Report（YYYY-MM-DD）

> 本日筛选自 N 个信息源（含 M 个 HN 顶级博客），共收录 X 条高质量内容

---

## 📝 今日看点

> 3-5 句话的宏观趋势总结

1. **趋势一** — 一句话描述
2. **趋势二** — 一句话描述
3. **趋势三** — 一句话描述

---

## 🏆 今日必读（Top 3）

### 1. 中文标题 / English Title

- **摘要**：4-6 句结构化摘要
- **推荐理由**：为什么值得读
- **要点**：
  1. 要点一
  2. 要点二
  3. 要点三
- **来源**：[来源](URL) | [原文](URL)
- **关键词**：`keyword1` `keyword2` `keyword3`
- **评分**：⭐⭐⭐⭐⭐ (5/5)
- **评分详情**：相关性 9 | 质量 9 | 时效 8
- **热度**：HN 780 points | 420 comments
- **分类**：🤖 AI / ML

---

## 🔥 HackerNews 热帖

### 4. 标题
（标准条目格式，含三维评分和分类）

---

## 📰 博客精选（HN Top Blogs）

### N. 中文标题 / English Title

- **作者**：博主名
- **摘要**：4-6 句结构化摘要
- **要点**：...
- **来源**：[博客名](URL)
- **关键词**：...
- **评分**：⭐⭐⭐⭐ (4/5)
- **评分详情**：相关性 8 | 质量 9 | 时效 7
- **分类**：⚙️ 工程

---

## 📄 HuggingFace 热门论文

（同原有格式，增加三维评分和分类）

---

## 📊 数据概览

### 📋 数据统计

| 指标 | 数值 |
|------|:----:|
| 信息源总数 | N |
| 收录条目 | X |
| 平均评分 | 4.2 / 5 |
| HN 博客命中 | M / 20 feeds |
| 分类覆盖 | K / 6 |

### 分类分布

| 分类 | 数量 | 占比 | 条形图 |
|------|:----:|:----:|--------|
| 🤖 AI / ML | 8 | 32% | `████████████████` |
| ⚙️ 工程 | 6 | 24% | `████████████` |
| 🛠 工具 / 开源 | 5 | 20% | `██████████` |
| 🔒 安全 | 3 | 12% | `██████` |
| 💡 观点 / 杂谈 | 2 | 8% | `████` |
| 📝 其他 | 1 | 4% | `██` |

### 🥧 分类饼图

\`\`\`mermaid
pie title 内容分类分布
    "🤖 AI / ML" : 8
    "⚙️ 工程" : 6
    "🛠 工具 / 开源" : 5
    "🔒 安全" : 3
    "💡 观点 / 杂谈" : 2
    "📝 其他" : 1
\`\`\`

### 热度分布

| 来源 | 条目数 | 平均热度 | 最高热度 |
|------|:------:|:--------:|:--------:|
| HN 热帖 | 15 | 437 pts | 1,898 pts |
| HN 博客 | 8 | — | — |
| HuggingFace | 5 | 20 upvotes | 29 upvotes |

### 📊 高频关键词柱状图

\`\`\`mermaid
xychart-beta
    title "高频关键词 Top 10"
    x-axis ["AI", "LLM", "Agent", "Rust", "Security", "OSS", "GPU", "RAG", "Python", "Infra"]
    y-axis "出现次数" 0 --> 15
    bar [12, 8, 6, 4, 3, 3, 3, 2, 2, 2]
\`\`\`

### 🏷️ 话题标签云

> 动态生成 SVG 标签云，字号按出现频次缩放，颜色按分类映射。
> 使用内联 `<img src="data:image/svg+xml;charset=utf-8,...">` 格式嵌入。
> 生成规则详见 [`../../_shared/format-spec.md`](../../_shared/format-spec.md) 第 6.5.5 节。

### 📈 来源贡献对比

\`\`\`mermaid
pie title 来源贡献占比
    "HN 热帖" : 15
    "HN 博客" : 8
    "HuggingFace" : 5
\`\`\`

---

## 其他推荐

| 排名 | 标题 | 热度 | 来源 | 分类 |
|------|------|------|------|------|
| N+1 | [标题](URL) | 指标 | 来源 | 分类 |

---

*Generated by Daily News Report v3.0*
*Date: YYYY-MM-DD*
```

### 格式要求（严格遵守）

| 规则 | 正确示例 | 错误示例 |
|------|----------|----------|
| 日期括号 | `（2026-02-15）` | `(2026-02-15)` |
| 评分显示 | `⭐⭐⭐⭐⭐ (5/5)` | `5/5` |
| 评分详情 | `相关性 9 \| 质量 8 \| 时效 7` | 无 |
| 分类标签 | `🤖 AI / ML` | 无分类 |
| 博客双语标题 | `中文 / English` | 仅英文 |
| 要点编号 | `1. 2. 3.` | `a. b. c.` |

## 步骤 5：更新缓存

按照 [`../../_shared/cache-schema.json`](../../_shared/cache-schema.json) 规范更新 `cache.json`。

## 步骤 5.5：Notion 自动同步（可选）

报告生成后，自动同步到 Notion 数据库。

### 前置检查

1. 验证 `.info-agent-plugin/utility-skills/notion-sync/config.json` 是否存在
2. 检查 `parent_page_id` 是否已配置
3. 验证 `user-Notion-*` 工具是否可用

如果配置完整，调用 notion-sync skill 执行同步。Notion 同步失败不影响报告生成。

## 步骤 6：失败处理与回退

### 单源失败

跳过此源，继续下一个。

### RSS 博客批量失败

如果超过 50% 的 RSS feeds 失败，在报告中标注警告但继续生成（使用 HN 首页数据）。

### 持续失败

如果某源连续 3 次失败，更新 `sources.json` 将该源移至 `disabled`。

## 快速参考

| 场景 | 操作 |
|------|------|
| 标准日报 | 执行 Step 0-5.5，三通道并行 |
| 某源 403 | 自动跳过或切换 Browser |
| RSS feed 失败 | 跳过该 feed，不影响其他 |
| 追加今日报告 | 检查 cache.json 避免重复 |

## 约束与原则

1. **宁缺毋滥**：低质量内容不进入日报
2. **早停机制**：够 25 条高质量就停止
3. **三通道并行**：HN 首页 + RSS 博客 + 其他源同时抓取
4. **三维评分**：相关性/质量/时效三维度打分
5. **六大分类**：所有内容自动归类
6. **双语标题**：博客源提供中英双语标题
7. **结构化摘要**：博客源 4-6 句深度摘要
8. **失败容错**：单个源失败不影响整体

## 依赖项

- **WebFetch / Jina Reader**：用于抓取页面和 RSS
- **Task 工具**：用于调度 subagent 并行执行
- **news-fetcher subagent**：专用抓取 worker
- **Notion MCP**：用于自动同步（可选）







