# HackerNews 抓取共享规范

本文档定义了从 HackerNews 抓取内容的统一规范，供 `daily-news-report` 等 Skills 共同引用。

## 一、目标页面

| 页面 | URL | 用途 | 时效性 |
|------|-----|------|--------|
| 首页 | `https://news.ycombinator.com` | 高热度内容 | 24-48 小时 |
| 最新 | `https://news.ycombinator.com/newest` | 最新内容 | 实时 |
| Show HN | `https://news.ycombinator.com/show` | 新项目展示 | 按需 |

## 二、抓取字段

### 2.1 必需字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `title` | string | 文章标题 | "GPT-5 Architecture Revealed" |
| `url` | string | 原文链接 | `https://example.com/article` |
| `hn_url` | string | HN 讨论链接 | `https://news.ycombinator.com/item?id=xxx` |
| `points` | number | 得分 | 150 |
| `comments` | number | 评论数 | 89 |

### 2.2 可选字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `timestamp` | string | 发布时间 | "2 hours ago" |
| `author` | string | 提交者 | "dang" |
| `domain` | string | 来源域名 | "github.com" |

## 三、抓取方法

### 3.1 WebFetch 方式（推荐）

适用于：简单列表页抓取

```
1. 使用 WebFetch 工具请求 HN URL
2. 解析返回的 HTML 内容
3. 提取文章列表信息
```

### 3.2 Browser 方式（备选）

适用于：需要 JS 渲染或 WebFetch 失败时

```
1. user-chrome-devtools-navigate_page(url="https://news.ycombinator.com")
2. user-chrome-devtools-take_snapshot() 获取页面快照
3. 从快照中提取文章列表
4. user-chrome-devtools-close_page() 关闭页面
```

### 3.3 页面元素识别

从页面快照/HTML 中识别以下元素：

| 元素 | 选择器/特征 | 说明 |
|------|------------|------|
| 文章行 | `.athing` | 每篇文章的容器 |
| 标题 | `.titleline > a` | 标题链接 |
| 得分 | `.score` | 如 "150 points" |
| 评论数 | 包含 "comments" 的链接 | 如 "89 comments" |
| 时间 | `.age` | 如 "2 hours ago" |

## 四、时间窗口过滤

### 4.1 过滤规则

| Skill | 时间窗口 | 说明 |
|-------|----------|------|
| daily-news-report | 24-48 小时 | HN 内容更新快，只取最新 |

### 4.2 时间解析

将 HN 的相对时间转换为绝对时间判断：

| 原始格式 | 含义 |
|----------|------|
| "N minutes ago" | N 分钟前 |
| "N hours ago" | N 小时前 |
| "N days ago" | N 天前 |
| "yesterday" | 昨天 |

**过滤逻辑**：
- 如果 `timestamp` 包含 "day" 且数字 > 2，排除
- 如果 `timestamp` 包含 "week" 或 "month"，排除

## 五、内容筛选

### 5.1 通用筛选关键词

**排除关键词**（标题包含则跳过）：

```
hiring, job, jobs, career, sponsor, ad, advertisement, 
who is hiring, freelancer, remote job
```

### 5.2 AI/LLM 专项筛选

**必需关键词**（标题需包含至少一个）：

```
AI, LLM, GPT, Claude, Gemini, Llama, Machine Learning, 
Deep Learning, Neural, Transformer, Diffusion, RAG, Agent,
OpenAI, Anthropic, Google AI, Meta AI, ChatGPT, Copilot, 
Mistral, Qwen, embedding, fine-tuning, inference
```

**加分关键词**（有则加分）：

```
breakthrough, release, launch, benchmark, open source, 
paper, research, state-of-the-art, SOTA
```

## 六、输出格式

### 6.1 JSON 输出 Schema

```json
{
  "source_id": "hn",
  "fetch_time": "ISO 时间戳",
  "articles": [
    {
      "title": "文章标题",
      "url": "原文链接",
      "hn_url": "https://news.ycombinator.com/item?id=xxx",
      "points": 150,
      "comments": 89,
      "timestamp": "2 hours ago",
      "domain": "github.com"
    }
  ]
}
```

### 6.2 数量限制

| Skill | 最大条目数 | 说明 |
|-------|-----------|------|
| daily-news-report | 10 | Tier1 源之一 |

## 七、错误处理

### 7.1 重试策略

| 错误类型 | 处理方式 |
|----------|----------|
| 网络超时 | 重试 1 次，间隔 5 秒 |
| 403/429 | 切换到 Browser 方式 |
| 解析失败 | 返回空数组，记录错误 |

### 7.2 降级策略

```
WebFetch 失败 → Browser 方式重试 → 记录错误，跳过该源
```

## 八、使用示例

### 在 Skill 中引用

```markdown
## HN 抓取

按照 [`./hn-fetcher.md`](./hn-fetcher.md) 规范执行 HN 内容抓取。

**本 Skill 特定配置**：
- 时间窗口：24 小时
- 最大条目：10
- 筛选模式：AI/LLM 专项（见 5.2 节）
```

### 在 SubAgent 中引用

```markdown
## HN 抓取规范

遵循 `_shared/hn-fetcher.md` 定义的抓取规范。
```




