# Playwright 内容提取器参考

当 Jina Reader 和专用脚本都失败时，使用 Playwright MCP 作为兜底方案。

## 基本流程

```javascript
// 1. 导航到页面
mcp__playwright__browser_navigate(url: "<URL>")

// 2. 等待内容加载
mcp__playwright__browser_wait_for(time: 3)

// 3. 获取页面快照验证加载
mcp__playwright__browser_snapshot()

// 4. 执行提取脚本
mcp__playwright__browser_evaluate(function: "<extractor>")
```

## 平台专用提取器

### X/Twitter Article

```javascript
() => {
    const container = document.querySelector('main') || document.body;
    const elements = container.querySelectorAll('[class*="longform-"]');
    const seen = new Set();
    const content = [];
    
    elements.forEach(el => {
        const key = el.getAttribute('data-offset-key');
        if (!key || seen.has(key)) return;
        seen.add(key);
        
        const classList = Array.from(el.classList);
        const type = classList.find(c => c.startsWith('longform-')) || 'longform-unstyled';
        const textSpans = el.querySelectorAll('span[data-text="true"]');
        const text = Array.from(textSpans).map(s => s.textContent).join('').trim();
        
        if (text) content.push({ type, text });
    });
    
    const titleEl = document.querySelector('[data-testid="twitter-article-title"]');
    const title = titleEl?.textContent?.trim() || document.title.split(' on X:')[0]?.trim() || '';
    const timeEl = document.querySelector('article time');
    const date = timeEl?.getAttribute('datetime')?.split('T')[0] || '';
    const authorMatch = location.pathname.match(/\/([^\/]+)\//);
    const author = authorMatch ? authorMatch[1] : '';
    
    return { title, author, date, url: location.href, content };
}
```

### ChatGPT Conversation

```javascript
() => {
    const messages = [];
    document.querySelectorAll('[data-message-author-role]').forEach(el => {
        const role = el.getAttribute('data-message-author-role');
        const content = el.querySelector('.markdown')?.innerText || el.innerText;
        messages.push({ role, content: content.trim() });
    });
    return { platform: 'ChatGPT', url: location.href, messages };
}
```

### Gemini Conversation

```javascript
() => {
    const messages = [];
    document.querySelectorAll('message-content, .conversation-turn').forEach(el => {
        const isUser = el.closest('[data-turn-role="user"]') !== null;
        const content = el.innerText.trim();
        if (content) messages.push({ role: isUser ? 'user' : 'assistant', content });
    });
    return { platform: 'Gemini', url: location.href, messages };
}
```

### 通用网页

```javascript
() => {
    const article = document.querySelector('article') || 
                    document.querySelector('main') || 
                    document.querySelector('.content') ||
                    document.body;
    
    const title = document.querySelector('h1')?.textContent?.trim() || 
                  document.title;
    
    const paragraphs = [];
    article.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li').forEach(el => {
        const text = el.textContent.trim();
        if (text) {
            const tag = el.tagName.toLowerCase();
            paragraphs.push({ tag, text });
        }
    });
    
    return { title, url: location.href, content: paragraphs };
}
```

## 调试脚本

### 查找可用选择器

```javascript
() => {
    return {
        testIds: [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))],
        hasMain: !!document.querySelector('main'),
        hasArticle: !!document.querySelector('article'),
        longformCount: document.querySelectorAll('[class*="longform-"]').length,
        messageCount: document.querySelectorAll('[data-message-author-role]').length
    };
}
```

## Markdown 转换格式

### X Article

```markdown
# {title}

**作者**: [@{author}](https://x.com/{author})
**日期**: {date}
**链接**: {url}

---

{content 按 type 转换:
  - longform-header-one → # heading
  - longform-header-two → ## heading
  - longform-blockquote → > quote
  - longform-unordered-list-item → - item
  - longform-ordered-list-item → 1. item
  - longform-unstyled → paragraph
}
```

### Conversation

```markdown
# {platform} Conversation

**链接**: {url}

---

## User
{user message}

## Assistant
{assistant message}
```

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| 页面未加载 | 增加 wait_for 时间 |
| 需要登录 | 让用户先手动登录 |
| 选择器失效 | 使用调试脚本查找正确选择器 |
| 内容在 iframe | 需要切换到 iframe 上下文 |
