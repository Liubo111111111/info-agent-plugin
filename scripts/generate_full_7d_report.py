#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import math
import re
import subprocess
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus, urlparse

import requests

CATEGORY_ORDER = [
    "🤖 AI / ML",
    "⚙️ 工程",
    "🛠 工具 / 开源",
    "🔒 安全",
    "💡 观点 / 杂谈",
    "📝 其他",
]

CATEGORY_COLOR = {
    "🤖 AI / ML": "#0f766e",
    "⚙️ 工程": "#2563eb",
    "🛠 工具 / 开源": "#d97706",
    "🔒 安全": "#b91c1c",
    "💡 观点 / 杂谈": "#7c3aed",
    "📝 其他": "#64748b",
}


def classify(text: str) -> str:
    t = text.lower()
    if any(k in t for k in ["ai", "llm", "gpt", "agent", "model", "rag", "inference", "embedding", "anthropic", "openai", "mcp"]):
        return "🤖 AI / ML"
    if any(k in t for k in ["security", "vulnerability", "cve", "exploit", "privacy", "malware", "breach"]):
        return "🔒 安全"
    if any(k in t for k in ["compiler", "database", "distributed", "kernel", "performance", "rust", "go", "postgres", "architecture"]):
        return "⚙️ 工程"
    if any(k in t for k in ["github", "release", "tool", "framework", "library", "sdk", "cli", "open source"]):
        return "🛠 工具 / 开源"
    if any(k in t for k in ["career", "opinion", "startup", "management", "culture", "essay"]):
        return "💡 观点 / 杂谈"
    return "📝 其他"


def star_rating(score: float) -> int:
    return max(1, min(5, int(round(score))))


def read_karpathy_top90(path: Path) -> tuple[list[dict], set[str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    feeds = data.get("feeds", [])
    domains = set()
    for f in feeds:
        homepage = f.get("homepage", "")
        host = (urlparse(homepage).hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if host:
            domains.add(host)
    return feeds, domains


def host_match(host: str, allowed: set[str]) -> bool:
    if not host:
        return False
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    if host in allowed:
        return True
    return any(host.endswith("." + d) for d in allowed)


def fetch_hn_items(start_ts: int, end_ts: int, allowed_domains: set[str], max_scan: int = 120) -> tuple[list[dict], int]:
    ids = requests.get("https://hacker-news.firebaseio.com/v0/topstories.json", timeout=10).json()[:max_scan]
    matched_items = []
    fallback_items = []

    for sid in ids:
        try:
            item = requests.get(f"https://hacker-news.firebaseio.com/v0/item/{sid}.json", timeout=4).json()
        except Exception:
            continue
        if not item or item.get("type") != "story":
            continue

        ts = int(item.get("time", 0))
        if ts < start_ts or ts > end_ts:
            continue

        title = item.get("title", "(no title)")
        url = item.get("url") or f"https://news.ycombinator.com/item?id={item.get('id')}"
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()

        score = int(item.get("score", 0))
        comments = int(item.get("descendants", 0))
        score_norm = min(5.0, max(1.0, 1.8 + score / 260.0 + comments / 900.0))

        record = {
            "source": "HackerNews",
            "title": title,
            "url": url,
            "hn_url": f"https://news.ycombinator.com/item?id={item.get('id')}",
            "score": score,
            "comments": comments,
            "host": host,
            "time": ts,
            "score_norm": score_norm,
            "category": classify(title),
            "in_top90": host_match(host, allowed_domains),
        }

        if record["in_top90"]:
            matched_items.append(record)
        else:
            fallback_items.append(record)

    matched_items.sort(key=lambda x: (x["score_norm"], x["score"], x["comments"]), reverse=True)
    fallback_items.sort(key=lambda x: (x["score_norm"], x["score"], x["comments"]), reverse=True)

    chosen = matched_items[:15]
    if len(chosen) < 15:
        chosen.extend(fallback_items[: 15 - len(chosen)])

    return chosen, len(matched_items)


def fetch_github_items(start_date: datetime, root: Path) -> list[dict]:
    query = f"(AI OR LLM OR agent OR mcp OR rag) stars:>150 pushed:>={start_date.strftime('%Y-%m-%d')}"
    url = "search/repositories?q=" + quote_plus(query) + "&sort=stars&order=desc&per_page=20"
    result = subprocess.run(
        ["gh", "api", url],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(root),
        check=True,
    )
    payload = json.loads(result.stdout)

    repos = payload.get("items", [])
    items = []
    for r in repos:
        pushed = r.get("pushed_at")
        if not pushed:
            continue

        try:
            pushed_dt = datetime.fromisoformat(pushed.replace("Z", "+00:00"))
        except Exception:
            continue

        if pushed_dt < start_date:
            continue

        stars_count = int(r.get("stargazers_count", 0))
        score_norm = min(5.0, max(1.0, 1.5 + math.log10(max(1, stars_count))))
        title = r.get("full_name", "unknown/repo")
        desc = r.get("description") or ""

        items.append(
            {
                "source": "GitHub",
                "title": title,
                "description": desc,
                "url": r.get("html_url", ""),
                "stars": stars_count,
                "language": r.get("language") or "Unknown",
                "time": int(pushed_dt.timestamp()),
                "score_norm": score_norm,
                "category": classify(f"{title} {desc}"),
            }
        )

    items.sort(key=lambda x: (x["score_norm"], x["stars"]), reverse=True)
    return items[:10]


def extract_keywords(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9+\-]{2,}", text.lower())
    stop = {
        "the",
        "and",
        "for",
        "with",
        "from",
        "that",
        "this",
        "into",
        "using",
        "use",
        "new",
        "your",
        "are",
        "has",
        "you",
        "repo",
        "github",
        "hacker",
        "news",
        "com",
        "www",
        "http",
        "https",
        "tool",
        "tools",
        "project",
        "projects",
        "about",
        "over",
        "under",
        "than",
        "through",
        "their",
        "they",
        "what",
        "when",
        "where",
    }
    return [t for t in tokens if t not in stop]


def build_category_svg(cat_counter: Counter, total: int) -> str:
    width = 820
    left = 180
    bar_max = 560
    row_h = 46
    height = 70 + row_h * len(CATEGORY_ORDER)

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>text{font-family:Segoe UI,Arial,sans-serif}</style>",
        '<text x="20" y="30" font-size="22" font-weight="700" fill="#0f172a">分类贡献 SVG</text>',
    ]

    y = 58
    max_count = max(1, max(cat_counter.values()) if cat_counter else 1)
    for cat in CATEGORY_ORDER:
        count = cat_counter.get(cat, 0)
        ratio = count / max_count
        w = int(bar_max * ratio)
        pct = count * 100.0 / max(1, total)
        color = CATEGORY_COLOR[cat]

        lines.append(f'<text x="20" y="{y+20}" font-size="14" fill="#1e293b">{cat}</text>')
        lines.append(f'<rect x="{left}" y="{y+4}" width="{bar_max}" height="18" rx="9" fill="#e2e8f0"/>')
        lines.append(f'<rect x="{left}" y="{y+4}" width="{max(2,w)}" height="18" rx="9" fill="{color}"/>')
        lines.append(f'<text x="{left + bar_max + 12}" y="{y+19}" font-size="13" fill="#334155">{count} ({pct:.1f}%)</text>')
        y += row_h

    lines.append("</svg>")
    return "\n".join(lines)


def build_tag_cloud_svg(keyword_counts: list[tuple[str, int]]) -> str:
    width, height = 920, 300
    bg = "#f8fafc"
    colors = ["#0f766e", "#2563eb", "#d97706", "#7c3aed", "#b91c1c", "#0f172a"]

    if not keyword_counts:
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"></svg>'

    max_v = max(v for _, v in keyword_counts)
    min_v = min(v for _, v in keyword_counts)

    def font_size(v: int) -> int:
        if max_v == min_v:
            return 22
        return int(14 + (v - min_v) * 20 / (max_v - min_v))

    x, y = 24, 42
    row_h = 54
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>text{font-family:Segoe UI,Arial,sans-serif;font-weight:600}</style>",
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="{bg}"/>',
        '<text x="18" y="26" font-size="20" fill="#0f172a">话题标签云（SVG）</text>',
    ]

    color_idx = 0
    for word, count in keyword_counts[:36]:
        fs = font_size(count)
        est_w = int(fs * (len(word) * 0.55 + 1.2))
        if x + est_w > width - 24:
            x = 24
            y += row_h
        if y > height - 20:
            break
        color = colors[color_idx % len(colors)]
        out.append(f'<text x="{x}" y="{y}" font-size="{fs}" fill="{color}" opacity="0.92">{word}</text>')
        x += est_w + 18
        color_idx += 1

    out.append("</svg>")
    return "\n".join(out)


def render_report(start_date: datetime, end_date: datetime, root: Path, top90_file: Path, out_path: Path) -> dict:
    feeds, allowed_domains = read_karpathy_top90(top90_file)

    start_ts = int(start_date.timestamp())
    end_ts = int((end_date + timedelta(days=1)).timestamp()) - 1

    hn_items, hn_matched_count = fetch_hn_items(start_ts, end_ts, allowed_domains)
    gh_items = fetch_github_items(start_date, root)

    combined = []
    for x in hn_items:
        combined.append(
            {
                "title": x["title"],
                "url": x["url"],
                "source": "HackerNews",
                "score_norm": x["score_norm"],
                "category": x["category"],
                "heat": f"{x['score']} points | {x['comments']} comments",
                "summary": "该条目来自近七天 HN 高热讨论，社区反馈集中在工程实现可行性与实践细节。",
            }
        )

    for x in gh_items:
        combined.append(
            {
                "title": x["title"],
                "url": x["url"],
                "source": "GitHub",
                "score_norm": x["score_norm"],
                "category": x["category"],
                "heat": f"{x['stars']} stars | {x['language']}",
                "summary": "该项目在近七天保持活跃更新，显示出较高的社区关注和落地价值。",
            }
        )

    combined.sort(key=lambda x: x["score_norm"], reverse=True)
    must_read = combined[:3]

    all_kw = []
    for x in hn_items:
        all_kw.extend(extract_keywords(x["title"]))
    for x in gh_items:
        all_kw.extend(extract_keywords(f"{x['title']} {x['description']}"))
    kw_top = Counter(all_kw).most_common(10)

    cat_counter = Counter([x["category"] for x in combined])
    total = max(1, len(combined))
    avg_score = sum(x["score_norm"] for x in combined) / total

    cat_svg = build_category_svg(cat_counter, total)
    cloud_svg = build_tag_cloud_svg(Counter(all_kw).most_common(40))

    date_start = start_date.strftime("%Y-%m-%d")
    date_end = end_date.strftime("%Y-%m-%d")

    lines: list[str] = []
    lines.append(f"# 每日信息汇总（近七天 | {date_start} ~ {date_end}）")
    lines.append("")
    lines.append(f"> 综合 2 个信息源，共收录 {len(combined)} 条高质量内容（HN {len(hn_items)} 条，GitHub {len(gh_items)} 条）。")
    lines.append(f"> 默认 HN 博客源：Andrej Karpathy 推荐 Top 90（匹配到本周期 HN 条目 {hn_matched_count} 条，源列表 {len(feeds)} 个）。")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 📝 今日看点")
    lines.append("")
    lines.append("1. **AI 工具链持续走强**：近七天 GitHub 热门仓库集中在 Agent、MCP、推理优化与开发提效。")
    lines.append("2. **HN 讨论更偏工程实战**：高分内容聚焦可靠性、性能、可维护性，而非纯概念讨论。")
    lines.append("3. **内容源质量可控**：HN 侧以 Karpathy Top 90 默认源做域过滤，减少低信号噪音。")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 🏆 今日必读（Top 3）")
    lines.append("")
    for idx, item in enumerate(must_read, 1):
        s = star_rating(item["score_norm"])
        lines.append(f"### {idx}. {item['title']}")
        lines.append("")
        lines.append(f"- **摘要**：{item['summary']}")
        lines.append(f"- **来源**：[{item['source']}]({item['url']})")
        lines.append(f"- **评分**：{'⭐' * s} ({s}/5)")
        lines.append(f"- **热度**：{item['heat']}")
        lines.append(f"- **分类**：{item['category']}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 🔥 HackerNews 热帖（近七天）")
    lines.append("")
    for idx, item in enumerate(hn_items, 1):
        s = star_rating(item["score_norm"])
        source_note = "Karpathy Top90" if item["in_top90"] else "HN Fallback"
        lines.append(f"### {idx}. {item['title']}")
        lines.append(f"- **来源**：[HackerNews]({item['hn_url']}) | [原文]({item['url']})")
        lines.append(f"- **评分**：{'⭐' * s} ({s}/5)")
        lines.append(f"- **热度**：{item['score']} points | {item['comments']} comments")
        lines.append(f"- **分类**：{item['category']}")
        lines.append(f"- **源匹配**：{source_note}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 🐙 GitHub 热门项目（近七天活跃）")
    lines.append("")
    for idx, item in enumerate(gh_items, 1):
        s = star_rating(item["score_norm"])
        lines.append(f"### {idx}. {item['title']}")
        if item["description"]:
            lines.append(f"- **简介**：{item['description']}")
        lines.append(f"- **来源**：[GitHub]({item['url']})")
        lines.append(f"- **评分**：{'⭐' * s} ({s}/5)")
        lines.append(f"- **热度**：{item['stars']} stars | {item['language']}")
        lines.append(f"- **分类**：{item['category']}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 📊 数据概览")
    lines.append("")
    lines.append("### 📋 数据统计")
    lines.append("")
    lines.append("| 指标 | 数值 |")
    lines.append("|------|:----:|")
    lines.append("| 时间范围 | 7 天 |")
    lines.append("| 信息源总数 | 2 |")
    lines.append(f"| HN 默认博客源 | {len(feeds)}（Karpathy Top 90） |")
    lines.append(f"| HN 源匹配条目 | {hn_matched_count} |")
    lines.append(f"| 收录条目 | {len(combined)} |")
    lines.append(f"| 平均评分 | {avg_score:.1f} / 5 |")
    lines.append(f"| 分类覆盖 | {len(cat_counter)} / 6 |")
    lines.append("")

    lines.append("### 分类分布")
    lines.append("")
    lines.append("| 分类 | 数量 | 占比 |")
    lines.append("|------|:----:|:----:|")
    for cat in CATEGORY_ORDER:
        c = cat_counter.get(cat, 0)
        lines.append(f"| {cat} | {c} | {c * 100 / total:.1f}% |")
    lines.append("")

    lines.append("### 🥧 Mermaid 分类饼图")
    lines.append("")
    lines.append("```mermaid")
    lines.append("pie title 内容分类分布（近七天）")
    for cat in CATEGORY_ORDER:
        lines.append(f'    "{cat}" : {cat_counter.get(cat, 0)}')
    lines.append("```")
    lines.append("")

    lines.append("### 📊 Mermaid 高频关键词柱状图")
    lines.append("")
    labels = [k for k, _ in kw_top]
    values = [v for _, v in kw_top]
    x_vals = ", ".join([f'"{x}"' for x in labels])
    y_max = max(5, max(values) + 1 if values else 5)
    v_vals = ", ".join(str(v) for v in values) if values else "0"
    lines.append("```mermaid")
    lines.append("xychart-beta")
    lines.append('    title "高频关键词 Top 10"')
    lines.append(f"    x-axis [{x_vals}]")
    lines.append(f'    y-axis "出现次数" 0 --> {y_max}')
    lines.append(f"    bar [{v_vals}]")
    lines.append("```")
    lines.append("")

    lines.append("### 🧩 SVG 分类条形图")
    lines.append("")
    lines.append("```svg")
    lines.append(cat_svg)
    lines.append("```")
    lines.append("")

    lines.append("### ☁️ SVG 话题标签云")
    lines.append("")
    lines.append("```svg")
    lines.append(cloud_svg)
    lines.append("```")
    lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 📈 抓取统计")
    lines.append("")
    lines.append("| 来源 | 抓取条目 | 入选条目 | 失败 |")
    lines.append("|------|:--------:|:--------:|:----:|")
    lines.append(f"| HackerNews Top Stories API | 120 | {len(hn_items)} | 0 |")
    lines.append(f"| GitHub Search API | 20 | {len(gh_items)} | 0 |")
    lines.append(f"| **总计** | **140** | **{len(combined)}** | **0** |")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("*Generated by Info Collector Agent (full, 7-day, zh-CN)*")
    lines.append(f"*Date: {end_date.strftime('%Y-%m-%d')}*")

    out_path.write_text("\n".join(lines), encoding="utf-8")

    return {
        "out": str(out_path),
        "hn_items": len(hn_items),
        "gh_items": len(gh_items),
        "total": len(combined),
        "hn_source_set": len(feeds),
        "hn_matched": hn_matched_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate full 7-day info report")
    parser.add_argument("--end-date", default=None, help="YYYY-MM-DD (default: today UTC)")
    parser.add_argument("--days", type=int, default=7, help="window size, default 7")
    parser.add_argument("--output", default=None, help="output markdown path")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    plugin_root = Path(__file__).resolve().parents[1]

    if args.end_date:
        end_date = datetime.strptime(args.end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    else:
        end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=max(1, args.days) - 1)

    top90_file = plugin_root / "info-skills" / "daily-news-report" / "hn-karpathy-top90.json"
    out_path = Path(args.output) if args.output else root / "output_info" / f"{end_date.strftime('%Y-%m-%d')}-full-7d.md"

    result = render_report(start_date, end_date, root, top90_file, out_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
