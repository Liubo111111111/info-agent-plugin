# Content Fetcher - 统一内容抓取模块

本文档定义了统一的内容抓取接口和流程，供所有信息提取类 Skills 使用。核心策略是 **Jina Reader 优先，Playwright MCP 回退**。

## 一、概述

### 1.1 设计目标

- **统一抓取策略**：所有 Skills 使用相同的内容抓取逻辑
- **可靠性优先**：Jina Reader 作为主要方法，Playwright MCP 作为可靠回退
- **可观测性**：完善的日志和统计信息

### 1.2 抓取优先级

| 优先级 | 方法 | 说明 |
|--------|------|------|
| 1 | 缓存 | 如果启用缓存且未过期，直接返回 |
| 2 | Jina Reader | 免费、快速、自动处理 JS 渲染 |
| 3 | Playwright MCP | 浏览器回退，处理 Jina 失败的情况 |

### 1.3 适用场景

- 网页内容转 Markdown
- GitHub 搜索结果页抓取
- HackerNews、Product Hunt 等技术资讯站点
- 任何需要可靠内容抓取的场景

## 二、接口定义

### 2.1 FetchOptions - 抓取选项

```typescript
interface FetchOptions {
  url: string;                    // 目标 URL（必需）
  enableCache?: boolean;          // 是否启用缓存，默认 true
  cacheTTLHours?: number;         // 缓存过期时间（小时），默认 24
  enablePlaywrightFallback?: boolean;  // 是否启用 Playwright 回退，默认 true
  playwrightTimeout?: number;     // Playwright 超时时间（毫秒），默认 30000
  minContentLength?: number;      // 最小有效内容长度，默认 100
}
```

### 2.2 FetchResult - 抓取结果

```typescript
interface FetchResult {
  success: boolean;               // 是否成功
  markdown?: string;              // Markdown 内容（成功时必有）
  source: 'jina' | 'playwright' | 'cache' | 'error';  // 内容来源
  url: string;                    // 原始 URL
  fetchedAt: string;              // 抓取时间 ISO 格式
  fallbackUsed: boolean;          // 是否使用了回退
  fallbackReason?: string;        // 回退原因（回退时必有）
  error?: string;                 // 错误信息（失败时必有）
  metadata?: {
    contentLength: number;        // 内容长度
    fetchDurationMs: number;      // 抓取耗时
  };
}
```

## 三、核心抓取流程

### 3.1 流程图

```
┌─────────────────┐
│   开始抓取      │
└────────┬────────┘
         ▼
┌─────────────────┐     命中
│   检查缓存      │────────────► 返回缓存内容 (source='cache')
└────────┬────────┘
         │ 未命中
         ▼
┌─────────────────┐     成功且内容有效
│  调用 Jina      │────────────► 保存缓存 → 返回 (source='jina')
│  Reader         │
└────────┬────────┘
         │ 失败或内容不足
         ▼
┌─────────────────┐
│ Playwright      │     否
│ 回退启用?       │────────────► 返回错误 (source='error')
└────────┬────────┘
         │ 是
         ▼
┌─────────────────┐     成功
│  调用 Playwright│────────────► 保存缓存 → 返回 (source='playwright')
│  MCP            │
└────────┬────────┘
         │ 失败
         ▼
┌─────────────────┐
│   返回错误      │
│ (source='error')│
└─────────────────┘
```

### 3.2 详细步骤

#### 步骤 1：检查缓存

```
IF enableCache = true:
    检查 URL 是否在缓存中
    IF 缓存存在 AND 未过期（< cacheTTLHours）:
        返回 {
            success: true,
            markdown: 缓存内容,
            source: 'cache',
            fallbackUsed: false
        }
```

#### 步骤 2：调用 Jina Reader

```bash
# 执行 Jina Reader 脚本
node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fetch-jina.js <url>
```

**成功响应示例**：
```json
{
  "success": true,
  "markdown": "# Page Title\n...",
  "source": "jina-reader",
  "url": "https://example.com"
}
```

**失败响应示例**：
```json
{
  "error": "HTTP 403",
  "fallback": true,
  "reason": "Jina API request failed"
}
```

**验证内容有效性**：
- 内容长度 >= minContentLength（默认 100 字符）
- 不包含错误页面标识（如 "Error" + "Unable to fetch"）

#### 步骤 3：Playwright MCP 回退

当 Jina Reader 失败或内容不足时，如果 `enablePlaywrightFallback=true`，执行 Playwright 回退。

## 四、Jina Reader 使用说明

### 4.1 基本信息

- **服务地址**：`https://r.jina.ai/<url>`
- **特点**：免费、无需 API key、自动处理 JS 渲染
- **返回格式**：Markdown

### 4.2 调用方式

```bash
# 通过脚本调用
node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fetch-jina.js "https://example.com"
```

### 4.3 常见失败原因

| 失败类型 | 原因 | 处理 |
|----------|------|------|
| HTTP 403 | 目标站点拒绝访问 | 回退到 Playwright |
| HTTP 429 | 请求频率限制 | 等待后重试或回退 |
| 内容不足 | 页面需要特殊渲染 | 回退到 Playwright |
| 超时 | 网络问题或页面过大 | 回退到 Playwright |

## 五、Playwright MCP 回退流程

当 Jina Reader 无法成功获取内容时，系统将自动回退到 Playwright MCP 进行浏览器抓取。

### 5.1 回退触发条件

以下任一条件满足时，将触发 Playwright MCP 回退（前提是 `enablePlaywrightFallback=true`）：

| 触发条件 | 说明 | 检测方式 |
|----------|------|----------|
| **Jina Reader 返回错误** | HTTP 错误（403、429、500 等）或网络错误 | 响应中包含 `error` 字段或 `success=false` |
| **内容长度不足** | 返回内容少于 `minContentLength`（默认 100 字符） | `markdown.length < minContentLength` |
| **Jina Reader 超时** | 请求超过默认超时时间（通常 30 秒） | 请求未在超时时间内返回 |
| **内容无效** | 返回的是错误页面而非实际内容 | 内容包含错误页面标识（如 "Error" + "Unable to fetch"） |

**回退决策伪代码**：

```javascript
function shouldFallbackToPlaywright(jinaResult, options) {
  // 条件 1: Jina 返回错误
  if (jinaResult.error || jinaResult.success === false) {
    return { fallback: true, reason: `Jina error: ${jinaResult.error || jinaResult.reason}` };
  }
  
  // 条件 2: 内容长度不足
  const minLength = options.minContentLength || 100;
  if (jinaResult.markdown && jinaResult.markdown.length < minLength) {
    return { fallback: true, reason: `Content too short: ${jinaResult.markdown.length} < ${minLength}` };
  }
  
  // 条件 3: 内容无效（错误页面检测）
  if (isErrorPage(jinaResult.markdown)) {
    return { fallback: true, reason: 'Jina returned error page content' };
  }
  
  return { fallback: false };
}
```

### 5.2 可用工具

| 工具 | 用途 |
|------|------|
| `mcp__playwright__browser_navigate` | 导航到页面 |
| `mcp__playwright__browser_snapshot` | 获取页面快照 |
| `mcp__playwright__browser_wait` | 等待元素/时间 |
| `mcp__playwright__browser_click` | 点击元素 |
| `mcp__playwright__browser_close` | 关闭浏览器 |

### 5.3 标准回退流程

```
1. 导航到页面
   mcp__playwright__browser_navigate(url="目标URL")

2. 等待内容加载
   mcp__playwright__browser_wait(time=3000)  # 或等待特定元素

3. 获取页面快照
   mcp__playwright__browser_snapshot()

4. 解析快照提取 Markdown 内容

5. 关闭浏览器（重要！）
   mcp__playwright__browser_close()
```

**完整调用示例**：

```javascript
// Playwright MCP 回退流程示例
async function playwrightFallback(url, options) {
  const timeout = options.playwrightTimeout || 30000;
  
  try {
    // 1. 导航到页面
    await mcp__playwright__browser_navigate({ url: url });
    
    // 2. 等待内容加载（可配置等待时间或等待特定元素）
    await mcp__playwright__browser_wait({ time: 3000 });
    
    // 3. 获取页面快照
    const snapshot = await mcp__playwright__browser_snapshot();
    
    // 4. 解析快照提取内容
    const markdown = parseSnapshotToMarkdown(snapshot);
    
    return {
      success: true,
      markdown: markdown,
      source: 'playwright'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      source: 'error'
    };
  } finally {
    // 5. 无论成功或失败，都必须关闭浏览器
    await mcp__playwright__browser_close();
  }
}
```

### 5.4 超时配置

Playwright 操作的超时时间可通过 `playwrightTimeout` 选项配置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `playwrightTimeout` | 30000ms | Playwright 整体操作超时时间 |

**不同页面类型的推荐超时设置**：

| 页面类型 | 推荐超时 | 说明 |
|----------|----------|------|
| 静态页面 | 15000ms | HN、简单博客等静态内容 |
| JS 渲染页面 | 30000ms | GitHub、Medium 等需要 JS 渲染的页面 |
| 复杂 SPA 应用 | 45000ms | X (Twitter)、Product Hunt 等复杂应用 |

**超时配置示例**：

```typescript
// 使用默认超时（30000ms）
const result = await fetchContent({
  url: 'https://github.com/search?q=llm',
  enablePlaywrightFallback: true
});

// 自定义超时（适用于复杂页面）
const result = await fetchContent({
  url: 'https://x.com/user/status/123',
  enablePlaywrightFallback: true,
  playwrightTimeout: 45000  // 45 秒超时
});
```

### 5.5 资源清理（重要！）

**无论 Playwright 操作成功或失败，都必须关闭浏览器以释放资源！**

#### 为什么资源清理很重要

- 浏览器进程占用大量内存和 CPU
- 未关闭的浏览器会导致资源泄漏
- 可能影响后续抓取操作的稳定性

#### 资源清理模式

**必须使用 try-finally 模式确保浏览器关闭**：

```javascript
// ✅ 正确的资源清理模式
try {
  // 执行 Playwright 抓取流程
  await mcp__playwright__browser_navigate({ url: targetUrl });
  await mcp__playwright__browser_wait({ time: 3000 });
  const snapshot = await mcp__playwright__browser_snapshot();
  // 处理快照...
} finally {
  // 无论成功或失败，都关闭浏览器
  await mcp__playwright__browser_close();
}

// ❌ 错误的模式（可能导致资源泄漏）
await mcp__playwright__browser_navigate({ url: targetUrl });
await mcp__playwright__browser_wait({ time: 3000 });
const snapshot = await mcp__playwright__browser_snapshot();
// 如果上面任何步骤失败，浏览器不会被关闭！
await mcp__playwright__browser_close();
```

#### 资源清理检查清单

- [ ] 每次 Playwright 操作都使用 try-finally 包裹
- [ ] finally 块中调用 `mcp__playwright__browser_close()`
- [ ] 即使发生异常也确保浏览器关闭
- [ ] 记录资源清理日志（可选）

## 六、缓存配置

### 6.1 缓存数据结构

```json
{
  "schema_version": "2.0",
  "entries": {
    "<url_hash>": {
      "url": "https://example.com/page",
      "markdown": "# Page Title\n...",
      "source": "jina",
      "fetchedAt": "2026-01-26T12:00:00Z",
      "expiresAt": "2026-01-27T12:00:00Z",
      "contentLength": 5000,
      "fetchDurationMs": 1200
    }
  }
}
```

### 6.2 缓存策略

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| enableCache | true | 是否启用缓存 |
| cacheTTLHours | 24 | 缓存过期时间（小时） |

### 6.3 缓存操作

- **检查缓存**：抓取前检查 URL 是否在缓存中且未过期
- **保存缓存**：成功抓取后保存到缓存
- **清除缓存**：支持清除指定 URL 或全部缓存

## 七、错误处理

### 7.1 错误类型

| 错误类型 | 描述 | 处理策略 |
|----------|------|----------|
| JINA_HTTP_ERROR | Jina HTTP 错误（403, 429 等） | 回退到 Playwright |
| JINA_TIMEOUT | Jina 请求超时 | 回退到 Playwright |
| JINA_CONTENT_INSUFFICIENT | Jina 返回内容不足 | 回退到 Playwright |
| PLAYWRIGHT_TIMEOUT | Playwright 操作超时 | 返回错误 |
| PLAYWRIGHT_CRASH | Playwright 浏览器崩溃 | 返回错误 |
| NETWORK_ERROR | 网络连接错误 | 返回错误 |

### 7.2 错误返回格式

```json
{
  "success": false,
  "source": "error",
  "url": "https://example.com",
  "error": "All fetch methods failed",
  "fallbackUsed": true,
  "fallbackReason": "Jina returned HTTP 403",
  "fetchedAt": "2026-01-26T12:00:00Z"
}
```

### 7.3 连续失败警告

当同一域名连续失败 3 次或以上时，记录警告：

```
[WARN] 域名 example.com 连续失败 3 次，建议检查网络连接或目标站点状态
```

## 八、日志记录

### 8.1 日志级别

| 级别 | 用途 |
|------|------|
| debug | 详细调试信息 |
| info | 正常操作记录 |
| warn | 警告信息（如回退、连续失败） |
| error | 错误信息 |

### 8.2 日志格式

**成功日志**：
```json
{
  "timestamp": "2026-01-26T12:00:00Z",
  "level": "info",
  "url": "https://example.com",
  "method": "jina",
  "success": true,
  "durationMs": 1200,
  "contentLength": 5000
}
```

**回退日志**：
```json
{
  "timestamp": "2026-01-26T12:00:00Z",
  "level": "warn",
  "url": "https://example.com",
  "method": "playwright",
  "success": true,
  "fallbackUsed": true,
  "fallbackReason": "Jina returned insufficient content",
  "durationMs": 8500
}
```

## 九、使用示例

### 9.1 在 Skill 中引用

```markdown
## 内容抓取

使用统一的 Content Fetcher 模块进行内容抓取，参考 [`./content-fetcher.md`](./content-fetcher.md)。

**抓取策略**：Jina Reader 优先，Playwright MCP 回退。
```

### 9.2 基本抓取示例

```
# 抓取 GitHub 搜索页面

1. 调用 Jina Reader
   node .info-agent-plugin/utility-skills/url-to-markdown/scripts/fetch-jina.js "https://github.com/search?q=llm&type=repositories"

2. 检查返回结果
   - 如果 success=true 且内容长度 >= 100，使用返回的 markdown
   - 如果失败或内容不足，执行 Playwright 回退

3. Playwright 回退（如需要）
   mcp__playwright__browser_navigate(url="https://github.com/search?q=llm&type=repositories")
   mcp__playwright__browser_wait(time=3000)
   mcp__playwright__browser_snapshot()
   # 解析快照内容
   mcp__playwright__browser_close()

4. 返回结构化结果
```

### 9.3 带缓存的抓取示例

```
# 带缓存的抓取流程

配置：
  enableCache: true
  cacheTTLHours: 24

流程：
1. 计算 URL 的哈希值
2. 检查缓存文件中是否存在该哈希
3. 如果存在且 expiresAt > 当前时间，返回缓存内容
4. 否则执行正常抓取流程
5. 抓取成功后保存到缓存
```

## 十、常见页面配置

### 10.1 GitHub 搜索页面

```
URL: https://github.com/search?q={keywords}&type=repositories
Jina: 通常可用
Playwright 超时: 30000ms
等待策略: 等待搜索结果加载
```

### 10.2 HackerNews

```
URL: https://news.ycombinator.com
Jina: 通常可用
Playwright 超时: 15000ms
等待策略: 等待 "points" 文本出现
```

### 10.3 Product Hunt

```
URL: https://www.producthunt.com
Jina: 可能需要回退
Playwright 超时: 30000ms
等待策略: 等待产品列表加载
```

### 10.4 X (Twitter)

```
URL: https://x.com/...
Jina: 通常失败（需要登录）
Playwright 超时: 45000ms
等待策略: 等待推文内容加载
注意: 依赖浏览器已有登录状态
```

## 十一、配置参考

### 11.1 默认配置

```json
{
  "content_fetcher": {
    "default_method": "jina",
    "enable_playwright_fallback": true,
    "playwright_timeout_ms": 30000,
    "min_content_length": 100,
    "cache": {
      "enabled": true,
      "ttl_hours": 24
    },
    "logging": {
      "level": "info",
      "log_fallbacks": true
    }
  }
}
```

### 11.2 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| default_method | string | "jina" | 默认抓取方法 |
| enable_playwright_fallback | boolean | true | 是否启用 Playwright 回退 |
| playwright_timeout_ms | number | 30000 | Playwright 超时时间 |
| min_content_length | number | 100 | 最小有效内容长度 |
| cache.enabled | boolean | true | 是否启用缓存 |
| cache.ttl_hours | number | 24 | 缓存过期时间 |
| logging.level | string | "info" | 日志级别 |
| logging.log_fallbacks | boolean | true | 是否记录回退日志 |

## 十二、相关文档

- [`browser-utils.md`](./browser-utils.md) - 浏览器抓取工具规范
- [`format-spec.md`](./format-spec.md) - 输出格式规范
- [`../utility-skills/url-to-markdown/scripts/fetch-jina.js`](../utility-skills/url-to-markdown/scripts/fetch-jina.js) - Jina Reader 脚本




