#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

# 设置 Windows 控制台编码
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    from dotenv import dotenv_values
    import requests
except ImportError:
    print("❌ Missing dependencies. Run: pip install python-dotenv requests")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
PLUGIN_ROOT = SKILL_DIR.parent.parent
WORKSPACE_ROOT = PLUGIN_ROOT.parent

PROJECT_ENV_PATH = PLUGIN_ROOT / ".env"
USER_ENV_PATH = Path.home() / ".info-agent-plugin" / ".env"
LEGACY_ENV_PATH = WORKSPACE_ROOT / ".env"


def resolve_env(key: str) -> Optional[str]:
    # Priority: process.env > project-level .env > user-level .env > legacy project .env
    if os.getenv(key):
        return os.getenv(key)

    project_env = dotenv_values(PROJECT_ENV_PATH) if PROJECT_ENV_PATH.exists() else {}
    if project_env.get(key):
        return project_env.get(key)

    user_env = dotenv_values(USER_ENV_PATH) if USER_ENV_PATH.exists() else {}
    if user_env.get(key):
        return user_env.get(key)

    legacy_env = dotenv_values(LEGACY_ENV_PATH) if LEGACY_ENV_PATH.exists() else {}
    if legacy_env.get(key):
        return legacy_env.get(key)

    return None


NOTION_API_KEY = resolve_env("NOTION_API_KEY")
NOTION_DATABASE_ID = resolve_env("NOTION_DATABASE_ID")
NOTION_VERSION = "2022-06-28"
CONFIG_PATH = SKILL_DIR / "config.json"
HISTORY_PATH = SKILL_DIR / "sync-history.json"
REPORT_DIR = WORKSPACE_ROOT / "output_info"

MAX_RETRIES = 3
RETRY_DELAY = 2


def load_config():
    if not CONFIG_PATH.exists():
        print(f"❌ Config not found: {CONFIG_PATH}")
        print("Please copy config.json.example to config.json and fill database_id")
        sys.exit(1)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def validate_required_env() -> None:
    missing = []
    if not NOTION_API_KEY:
        missing.append("NOTION_API_KEY")
    if missing:
        print(f"❌ Missing required environment variables: {', '.join(missing)}")
        print(f"Checked: {PROJECT_ENV_PATH}")
        print(f"Checked: {USER_ENV_PATH}")
        sys.exit(1)


def resolve_database_id(config: dict) -> Optional[str]:
    # Priority: env NOTION_DATABASE_ID > config.database_id
    if NOTION_DATABASE_ID:
        return NOTION_DATABASE_ID
    return config.get("database_id")


def resolve_report_path(report_date: str) -> Optional[Path]:
    candidates = [
        REPORT_DIR / f"{report_date}-news-report.md",
        REPORT_DIR / f"{report_date}-full.md",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def load_history():
    if not HISTORY_PATH.exists():
        return {"synced_urls": [], "stats": {"total_synced": 0, "total_skipped": 0}}
    with open(HISTORY_PATH, "r", encoding="utf-8") as f:
        history = json.load(f)
    history.setdefault("synced_urls", [])
    history.setdefault("stats", {})
    history["stats"].setdefault("total_synced", 0)
    history["stats"].setdefault("total_skipped", 0)
    return history


def save_history(history):
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)


def parse_report(report_path):
    with open(report_path, "r", encoding="utf-8") as f:
        content = f.read()

    articles = []
    # 支持 ## 和 ### 两种标题层级
    section_pattern = re.compile(
        r"(?m)^##{1,2}\s+(\d+)\.\s+(.+?)\n(.*?)(?=^##{1,2}\s+\d+\.\s+|\Z)",
        re.DOTALL,
    )
    matches = section_pattern.findall(content)

    for rank_str, title_raw, article_text in matches:
        rank = int(rank_str)
        title = title_raw.strip()

        summary_match = re.search(
            r"- \*\*摘要\*\*：(.+?)(?=\n- \*\*要点\*\*：)", article_text, re.DOTALL
        )
        summary = summary_match.group(1).strip() if summary_match else ""

        key_points_match = re.search(
            r"- \*\*要点\*\*：\n((?:  \d+\. .+\n?)+)", article_text
        )
        key_points = ""
        if key_points_match:
            points = re.findall(r"  \d+\. (.+)", key_points_match.group(1))
            key_points = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(points))

        url_match = re.search(r"\[原文\]\((.+?)\)", article_text)
        url = url_match.group(1) if url_match else ""

        source_match = re.search(r"- \*\*来源\*\*：\[(.+?)\]", article_text)
        source = source_match.group(1) if source_match else "Other"

        keywords_match = re.search(r"- \*\*关键词\*\*：(.+)", article_text)
        keywords = []
        if keywords_match:
            keywords = re.findall(r"`([^`]+)`", keywords_match.group(1))

        score_match = re.search(r"- \*\*评分\*\*：⭐+\s*\((\d+)/5\)", article_text)
        score = score_match.group(1) if score_match else "3"

        articles.append(
            {
                "rank": rank,
                "title": title,
                "summary": summary,
                "key_points": key_points,
                "url": url,
                "source": source,
                "keywords": keywords[:5],
                "score": score,
            }
        )

    return articles


def create_notion_page(database_id, article, report_date):
    url = "https://api.notion.com/v1/pages"
    headers = {
        "Authorization": f"Bearer {NOTION_API_KEY}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
    }

    data = {
        "parent": {"database_id": database_id},
        "properties": {
            "Title": {"title": [{"text": {"content": article["title"]}}]},
            "Summary": {
                "rich_text": [{"text": {"content": article["summary"][:2000]}}]
            },
            "KeyPoints": {
                "rich_text": [{"text": {"content": article["key_points"][:2000]}}]
            },
            "URL": {"url": article["url"]},
            "Source": {"select": {"name": article["source"]}},
            "Score": {"select": {"name": article["score"]}},
            "Rank": {"number": article["rank"]},
            "ReportDate": {"date": {"start": report_date}},
            "Keywords": {"multi_select": [{"name": kw} for kw in article["keywords"]]},
        },
    }

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(url, headers=headers, json=data, timeout=30)
            return response
        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                print(f"  ⚠️ Retry {attempt + 1}/{MAX_RETRIES}: {e}")
                time.sleep(RETRY_DELAY)
    raise last_error  # type: ignore


def verify_database(database_id):
    url = "https://api.notion.com/v1/search"
    headers = {
        "Authorization": f"Bearer {NOTION_API_KEY}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
    }
    data = {"filter": {"property": "object", "value": "database"}}

    response = requests.post(url, headers=headers, json=data, timeout=30)
    if response.status_code != 200:
        return False, f"API error: {response.status_code}"

    results = response.json().get("results", [])
    for db in results:
        if db["id"].replace("-", "") == database_id.replace("-", ""):
            return True, db.get("title", [{}])[0].get("plain_text", "Untitled")

    return False, "Database not found or not shared with integration"


def main():
    validate_required_env()

    config = load_config()
    database_id = resolve_database_id(config)

    if not database_id:
        print("❌ Missing database id: set NOTION_DATABASE_ID or config.json(database_id)")
        sys.exit(1)

    report_date = datetime.now().strftime("%Y-%m-%d")
    force_sync = False

    if len(sys.argv) > 1:
        if sys.argv[1] == "--force" or sys.argv[1] == "-f":
            force_sync = True
            if len(sys.argv) > 2:
                report_date = sys.argv[2]
        else:
            report_date = sys.argv[1]

    report_path = resolve_report_path(report_date)
    if report_path is None:
        print(f"❌ Report not found for date: {report_date}")
        print(f"Tried: {REPORT_DIR / f'{report_date}-news-report.md'}")
        print(f"Tried: {REPORT_DIR / f'{report_date}-full.md'}")
        sys.exit(1)

    print(f"🔍 Verifying database access...")
    db_ok, db_info = verify_database(database_id)
    if not db_ok:
        print(f"❌ Database error: {db_info}")
        print("Please ensure the Integration has access to the database")
        sys.exit(1)
    print(f"✅ Database: {db_info}")

    print(f"📰 Parsing report: {report_path}")
    articles = parse_report(report_path)
    print(f"✅ Found {len(articles)} articles")

    history = load_history()
    synced_urls = set(history.get("synced_urls", []))

    if force_sync:
        print("🔄 Force sync mode: will sync all articles (may create duplicates)")
        new_articles = articles
    else:
        new_articles = [a for a in articles if a["url"] not in synced_urls]
    
    print(f"🆕 New articles to sync: {len(new_articles)}")

    if not new_articles:
        print("✅ All articles already synced!")
        if not force_sync:
            print("💡 Tip: Use --force flag to re-sync all articles")
        return

    success_count = 0
    failed = []

    for i, article in enumerate(new_articles, 1):
        print(f"[{i}/{len(new_articles)}] Syncing: {article['title'][:50]}...")
        try:
            response = create_notion_page(database_id, article, report_date)
            if response.status_code == 200:
                success_count += 1
                synced_urls.add(article["url"])
                print("  ✅ Success")
            else:
                failed.append(
                    (article["title"], response.status_code, response.text[:100])
                )
                print(f"  ❌ Failed: {response.status_code}")
        except Exception as e:
            failed.append((article["title"], "Error", str(e)[:100]))
            print(f"  ❌ Error: {e}")

    history["synced_urls"] = list(synced_urls)
    history["last_sync"] = datetime.now().isoformat()
    history["stats"]["total_synced"] = len(synced_urls)
    save_history(history)

    print(f"\n📊 Sync Summary:")
    print(f"  ✅ Success: {success_count}")
    print(f"  ❌ Failed: {len(failed)}")

    if failed:
        print(f"\n❌ Failed articles:")
        for title, code, msg in failed:
            print(f"  - {title[:50]}: {code}")


if __name__ == "__main__":
    main()
