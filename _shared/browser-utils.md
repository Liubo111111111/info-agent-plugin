# 浏览器抓取工具规范

本文档定义了使用 Playwright MCP 进行浏览器抓取的统一规范，供需要 JS 渲染的页面抓取场景使用。

> **重要**：浏览器抓取应作为 **回退方案**，优先使用 Jina Reader。详见 [`content-fetcher.md`](./content-fetcher.md)。

## 一、抓取策略

### 1.1 Jina 优先原则

**所有内容抓取应遵循以下优先级**：

| 优先级 | 方法 | 说明 |
|--------|------|------|
| 1 | Jina Reader | 免费、快速、自动处理 JS 渲染 |
| 2 | Playwright MCP | 浏览器回退，处理 Jina 失败的情况 |

**何时使用 Playwright MCP 回退**：

- Jina Reader 返回 HTTP 错误（403、429 等）
- Jina Reader 返回内容不足（< 100 字符）
- Jina Reader 超时或网络错误
- 需要登录状态的页面（如 X/Twitter）

### 1.2 适用场景

| 场景 | 说明 | 示例 |
|------|------|------|
| Jina 失败回退 | Jina Reader 无法获取内容 | 403 错误、内容不足 |
| JS 渲染页面 | 内容由 JavaScript 动态加载 | Product Hunt, Substack |
| 需要交互 | 滚动加载、点击展开 | 无限滚动页面 |
| 登录后内容 | 需要已登录状态 | X 列表 |

## 二、Playwright MCP 工具

### 2.1 可用工具列表

| 工具 | 用途 | 常用参数 |
|------|------|----------|
| `mcp__playwright__browser_navigate` | 导航到 URL | `url` |
| `mcp__playwright__browser_snapshot` | 获取页面快照 | - |
| `mcp__playwright__browser_wait` | 等待元素/时间 | `time`, `selector` |
| `mcp__playwright__browser_click` | 点击元素 | `element`, `ref` |
| `mcp__playwright__browser_close` | 关闭浏览器 | - |
| `mcp__playwright__browser_type` | 输入文本 | `element`, `ref`, `text` |
| `mcp__playwright__browser_scroll` | 滚动页面 | `direction` |

### 2.2 工具详细说明

#### browser_navigate
导航到指定 URL。

```
mcp__playwright__browser_navigate(url="https://example.com")
```

#### browser_snapshot
获取当前页面的无障碍树快照，返回页面结构和内容。

```
mcp__playwright__browser_snapshot()
```

#### browser_wait
等待指定时间或元素出现。

```
# 等待 3 秒
mcp__playwright__browser_wait(time=3000)

# 等待特定元素
mcp__playwright__browser_wait(selector=".content-loaded")
```

#### browser_click
点击页面元素。

```
mcp__playwright__browser_click(element="Load More button", ref="btn-123")
```

#### browser_close
关闭浏览器，释放资源。**必须在操作完成后调用！**

```
mcp__playwright__browser_close()
```

### 2.3 工具限制

**重要**：MCP 工具在后台 subagent 中不可用，必须在前台执行。

## 三、标准抓取流程

### 3.1 基础流程

```
1. 导航到页面
   mcp__playwright__browser_navigate(url="目标URL")

2. 等待内容加载
   mcp__playwright__browser_wait(time=3000)

3. 获取页面快照
   mcp__playwright__browser_snapshot()

4. 解析快照提取数据
   （从返回的快照文本中提取所需信息）

5. 关闭浏览器（重要！避免资源泄漏）
   mcp__playwright__browser_close()
```

### 3.2 带滚动的流程

```
1-2. 同上

3. 滚动加载更多
   mcp__playwright__browser_scroll(direction="down")
   mcp__playwright__browser_wait(time=2000)

4. 重复步骤 3 直到满足条件

5-6. 快照和关闭
```

### 3.3 带点击的流程

```
1-2. 同上

3. 获取快照找到目标元素
   mcp__playwright__browser_snapshot()

4. 点击目标元素
   mcp__playwright__browser_click(element="元素描述", ref="元素ref")

5. 等待响应
   mcp__playwright__browser_wait(time=2000)

6-7. 快照和关闭
```

### 3.4 资源清理模式（重要！）

**必须使用 try-finally 模式确保浏览器关闭**：

```javascript
// ✅ 正确的资源清理模式
try {
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
await mcp__playwright__browser_snapshot();
// 如果上面任何步骤失败，浏览器不会被关闭！
await mcp__playwright__browser_close();
```

## 四、快照解析

### 4.1 快照格式

快照返回的是页面的无障碍树（Accessibility Tree）文本表示，包含：

- 元素类型（link, text, button 等）
- 元素内容
- 元素 ref（用于交互）
- 层级结构

### 4.2 常见元素识别

| 目标 | 识别特征 | 示例 |
|------|----------|------|
| 文章标题 | `link` 类型，包含标题文本 | `[link] "GPT-5 Released"` |
| 按钮 | `button` 类型 | `[button] "Load More"` |
| 数字指标 | `text` 类型，包含数字 | `[text] "150 points"` |
| 列表项 | `listitem` 类型 | `[listitem] ...` |

### 4.3 提取技巧

1. **识别模式**：先手动查看一次快照，识别内容结构
2. **锚点定位**：通过固定文本找到相对位置
3. **正则匹配**：对数字、日期等使用正则提取

## 五、常见页面配置

### 5.1 GitHub 搜索页面

```
URL: https://github.com/search?q={keywords}&type=repositories
Jina: 通常可用，优先使用
Playwright 超时: 30000ms
等待策略: 等待搜索结果加载
等待时间: 3000ms
```

### 5.2 HackerNews

```
URL: https://news.ycombinator.com
Jina: 通常可用，优先使用
Playwright 超时: 15000ms
等待策略: 等待 "points" 文本出现
等待时间: 2000ms
```

### 5.3 Product Hunt

```
URL: https://www.producthunt.com
Jina: 可能需要回退
Playwright 超时: 30000ms
等待策略: 等待产品列表加载
等待时间: 5000ms
注意: 需要滚动加载更多
```

### 5.4 X 列表（需要登录）

```
URL: https://x.com/i/lists/{list_id}
Jina: 通常失败（需要登录）
Playwright 超时: 45000ms
等待策略: 等待推文内容出现
等待时间: 5000ms
注意: 依赖浏览器已有登录状态
```

### 5.5 Substack（如 Latent Space）

```
URL: https://www.latent.space
Jina: 通常可用
Playwright 超时: 20000ms
等待策略: 等待文章标题出现
等待时间: 3000ms
```

### 5.6 HuggingFace Papers

```
URL: https://huggingface.co/papers
Jina: 通常可用
Playwright 超时: 20000ms
等待策略: 等待论文列表加载
等待时间: 3000ms
```

## 六、超时配置

### 6.1 推荐超时值

| 页面类型 | Playwright 超时 | 等待时间 | 说明 |
|----------|-----------------|----------|------|
| 静态为主 | 15000ms | 2000ms | HN、简单页面 |
| JS 渲染 | 30000ms | 3000ms | GitHub、Medium |
| 复杂应用 | 45000ms | 5000ms | X、Product Hunt |

### 6.2 配置示例

```json
{
  "playwright": {
    "default_timeout_ms": 30000,
    "default_wait_ms": 3000
  }
}
```

## 七、错误处理

### 7.1 常见错误

| 错误 | 原因 | 处理 |
|------|------|------|
| 导航超时 | 页面加载慢 | 增加超时，重试 |
| 元素未找到 | 选择器错误或页面变化 | 检查快照，更新选择器 |
| 浏览器崩溃 | 资源不足 | 减少并行数，关闭其他页面 |

### 7.2 重试策略

```
第一次失败 → 等待 3 秒 → 重试一次
第二次失败 → 记录错误 → 返回失败结果
```

### 7.3 资源清理检查清单

- [ ] 每次 Playwright 操作都使用 try-finally 包裹
- [ ] finally 块中调用 `mcp__playwright__browser_close()`
- [ ] 即使发生异常也确保浏览器关闭
- [ ] 记录资源清理日志（可选）

## 八、性能建议

### 8.1 优先使用 Jina Reader

- **首选 Jina Reader**：免费、快速、无需管理浏览器
- **Playwright 作为回退**：仅在 Jina 失败时使用
- 参考 [`content-fetcher.md`](./content-fetcher.md) 了解完整抓取策略

### 8.2 减少浏览器使用

- 优先使用 Jina Reader
- 浏览器抓取作为后备方案
- 缓存成功抓取的内容

### 8.3 避免并行

- 浏览器抓取不建议并行（资源消耗大）
- 如需多源，串行执行或限制并发数

## 九、使用示例

### 9.1 在 Skill 中引用

```markdown
## 内容抓取

使用统一的 Content Fetcher 模块进行内容抓取，参考 [`./content-fetcher.md`](./content-fetcher.md)。

**抓取策略**：Jina Reader 优先，Playwright MCP 回退。

如需直接使用 Playwright MCP，参考 [`./browser-utils.md`](./browser-utils.md)。
```

### 9.2 Playwright 回退示例

```
# Jina 失败后的 Playwright 回退流程

1. mcp__playwright__browser_navigate(url="https://github.com/search?q=llm")
2. mcp__playwright__browser_wait(time=3000)
3. mcp__playwright__browser_snapshot()
4. 从快照中提取搜索结果
5. mcp__playwright__browser_close()
```

## 十、相关文档

- [`content-fetcher.md`](./content-fetcher.md) - 统一内容抓取模块（**推荐首先阅读**）
- [`format-spec.md`](./format-spec.md) - 输出格式规范
- [`../utility-skills/url-to-markdown/scripts/fetch-jina.js`](../utility-skills/url-to-markdown/scripts/fetch-jina.js) - Jina Reader 脚本




