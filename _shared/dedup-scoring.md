# 去重与评分共享规范

本文档定义了信息提取类 Skills 的去重和评分统一规范。

## 一、去重机制

### 1.1 去重层级

按优先级从高到低执行，匹配则视为重复：

| 优先级 | 方法 | 说明 | 适用场景 |
|--------|------|------|----------|
| 1 | URL 完全匹配 | 相同 URL 视为重复 | 所有场景 |
| 2 | 历史记录检查 | 检查 cache.json | 防止跨批次重复 |
| 3 | 标题相似度 | 相似度 > 80% 视为重复 | 不同源相同内容 |
| 4 | 内容指纹 | Hash 匹配 | 精确去重 |

### 1.2 URL 去重

#### 规范化处理

在比较前对 URL 进行规范化：

```
1. 移除协议差异：http:// 和 https:// 视为相同
2. 移除尾部斜杠：example.com/path/ → example.com/path
3. 移除常见追踪参数：utm_*, ref, source
4. 统一大小写：域名转小写
```

#### 示例

```
# 以下 URL 视为相同
https://example.com/article?utm_source=twitter
http://example.com/article/
https://Example.com/article
```

### 1.3 标题相似度计算

#### 算法

使用简化的相似度计算：

```
1. 分词：按空格和标点分割
2. 转小写
3. 移除停用词（the, a, an, is, are, of, to, in, for）
4. 计算 Jaccard 相似度：|A ∩ B| / |A ∪ B|
```

#### 阈值

| 相似度 | 判定 |
|--------|------|
| > 80% | 重复，保留评分更高的 |
| 60-80% | 可能相关，标记但保留 |
| < 60% | 不同内容 |

### 1.4 内容指纹

#### 生成方法

```
1. 提取标题 + 摘要前 100 字符
2. 移除空白和标点
3. 转小写
4. 计算 Hash（简化：取前 50 字符作为指纹）
```

#### 存储格式

```json
{
  "content_hashes": {
    "entries": {
      "gpt5releasedopenai...": "2026-01-23",
      "claudeanthropicnew...": "2026-01-23"
    },
    "ttl_days": 7
  }
}
```

## 二、评分体系（v3.0 三维评分）

### 2.1 三维评分标准

v3.0 采用三维度评分，替代原有的 1-5 简单评分：

| 维度 | 权重 | 1-3 分 | 4-6 分 | 7-10 分 |
|------|------|--------|--------|---------|
| 相关性 (R) | 40% | 与技术无关 | 一般技术内容 | AI/前沿核心 |
| 质量 (Q) | 35% | 浅层/水文 | 有参考价值 | 深度原创/突破 |
| 时效性 (T) | 25% | 过时内容 | 近期发布 | 刚发布/突发 |

### 2.2 最终星级映射

```
weighted = R * 0.4 + Q * 0.35 + T * 0.25
final_star = round(weighted / 2)  # 映射到 1-5 星
```

| 加权分 | 星级 | 显示 |
|--------|------|------|
| 9-10 | 5 | `⭐⭐⭐⭐⭐ (5/5)` |
| 7-8.9 | 4 | `⭐⭐⭐⭐ (4/5)` |
| 5-6.9 | 3 | `⭐⭐⭐ (3/5)` |
| 3-4.9 | 2 | `⭐⭐ (2/5)` |
| 1-2.9 | 1 | `⭐ (1/5)` |

### 2.3 来源参考指标（辅助三维评分）

不同来源的热度指标作为评分参考：

| 来源 | 高分参考 (R/Q 7+) | 中分参考 (4-6) | 低分参考 (1-3) |
|------|-------------------|----------------|----------------|
| HN 首页 | >300 pts | 50-300 pts | <50 pts |
| HN 博客 (rank 1-5) | 任何新文章 | — | — |
| GitHub | >10k ⭐ | 1k-10k ⭐ | <1k ⭐ |
| HuggingFace | >50 likes | 10-50 | <10 |
| X/Twitter | >5k likes | 500-5k | <500 |

### 2.4 来源权重加成

| 来源 | 加成方式 | 说明 |
|------|----------|------|
| HN 首页 (>300 pts) | relevance +1 | 社区验证的高相关性 |
| HN 顶级博客 (rank 1-5) | quality +1 | 顶级博主的内容质量保证 |
| HN 顶级博客 (rank 6+) | quality +0.5 | 优质博主 |
| HF Papers (>50 likes) | relevance +1 | 学术社区验证 |
| Tier2 源 | 无加成 | 基础权重 |

### 2.5 关键词加成（作用于相关性维度）

| 关键词类型 | relevance 加成 | 示例 |
|------------|---------------|------|
| 突破性 | +1.5 | breakthrough, SOTA, state-of-the-art |
| 发布类 | +1.0 | release, launch, announce |
| 开源类 | +1.0 | open source, open-source, OSS |
| 研究类 | +0.5 | paper, research, study |

### 2.6 评分输出格式

```markdown
- **评分**：⭐⭐⭐⭐ (4/5)
- **评分详情**：相关性 9 | 质量 8 | 时效 7
```

## 三、排序规则

### 3.1 主排序

```
1. 按 final_star 降序
2. 同星级按三维加权分降序
3. 同加权分按热度指标降序
4. 同热度按时间降序（最新优先）
```

### 3.2 输出截取

| Skill | 截取数量 | 说明 |
|-------|----------|------|
| daily-news-report | Top 25 | 完整报告（含 Top 3 必读） |
| x-digest | Top 3-5 | 精选摘要 |

### 3.3 今日必读选取

从 Top 25 中选出 Top 3 作为「今日必读」，优先选择：
1. 三维加权分最高的
2. 来源多样性（尽量覆盖不同来源）
3. 分类多样性（尽量覆盖不同分类）

## 四、评分校准（v3.0）

### 4.1 跨源校准

三维评分天然支持跨源校准：
- HN 热帖：热度指标辅助 relevance 和 timeliness 评分
- RSS 博客：博主排名辅助 quality 评分
- HF Papers：likes 辅助 relevance 评分
- 无热度指标的源：纯内容评估

### 4.2 批次内校准

同一批次抓取的内容，需要相对校准：

```
1. 先按来源分组计算三维分
2. 应用来源权重加成
3. 计算加权分和星级
4. 合并后重新排序
5. 确保 Top 3 必读覆盖不同来源和分类
```

## 五、配置示例

### 5.1 在 sources.json 中配置

```json
{
  "quality_weights": {
    "source_weights": {
      "hn": 1.2,
      "hf_papers": 1.3,
      "paul_graham": 1.2,
      "x_list": 1.0
    },
    "engagement_weights": {
      "hn_points": 0.01,
      "hn_comments": 0.02,
      "x_likes": 0.005,
      "x_retweets": 0.01
    }
  },
  "quality_thresholds": {
    "min_score_to_include": 3,
    "target_items": 20
  }
}
```

### 5.2 在 Skill 中引用

```markdown
## 去重与评分

按照 [`./dedup-scoring.md`](./dedup-scoring.md) 规范执行去重和评分。

**本 Skill 特定配置**：
- 最低收录分数：3
- 目标条目数：20
```

## 六、实现示例

### 6.1 去重伪代码

```python
def deduplicate(items, cache):
    seen_urls = set(cache.get("url_cache", {}).keys())
    seen_hashes = set(cache.get("content_hashes", {}).keys())
    
    result = []
    for item in items:
        # URL 去重
        normalized_url = normalize_url(item["url"])
        if normalized_url in seen_urls:
            continue
        
        # 内容指纹去重
        content_hash = generate_hash(item["title"])
        if content_hash in seen_hashes:
            continue
        
        # 标题相似度去重
        if any(title_similarity(item["title"], r["title"]) > 0.8 for r in result):
            continue
        
        seen_urls.add(normalized_url)
        seen_hashes.add(content_hash)
        result.append(item)
    
    return result
```

### 6.2 评分伪代码

```python
def calculate_score(item, source_config):
    base_score = item.get("quality_score", 3)
    
    # 热度加成
    engagement_bonus = 0
    if "points" in item:  # HN
        engagement_bonus = min(1.0, item["points"] * 0.01 + item.get("comments", 0) * 0.02)
    elif "likes" in item:  # X
        engagement_bonus = min(1.0, item["likes"] * 0.005 + item.get("retweets", 0) * 0.01)
    
    # 来源加成
    source_bonus = source_config.get("weight", 0)
    
    # 关键词加成
    keyword_bonus = calculate_keyword_bonus(item["title"])
    
    return min(5, base_score + engagement_bonus + source_bonus + keyword_bonus)
```




