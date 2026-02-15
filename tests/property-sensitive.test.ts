import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function listFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function isIgnored(relPath: string): boolean {
  const rel = toPosix(relPath);
  return (
    rel.endsWith("/.env") ||
    rel.endsWith("/sources.json") ||
    rel.endsWith("/config.json") ||
    rel.endsWith("/cache.json") ||
    rel.endsWith("/sync-history.json") ||
    rel.endsWith("/EXTEND.md") ||
    rel.startsWith("output_info/") ||
    rel.includes("/node_modules/")
  );
}

describe("Feature: info-agent-plugin, Property 1: 仓库中无敏感信息泄露", () => {
  const sensitivePatterns = [
    /ntn_(?!your|YOUR)[A-Za-z0-9_-]{8,}/g,
    /sk-(?!your|YOUR)[A-Za-z0-9_-]{8,}/g,
    /ghp_(?!your|YOUR)[A-Za-z0-9_-]{8,}/g,
    /https:\/\/x\.com\/i\/lists\/\d{8,}/g,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
  ];

  const trackedFiles = listFiles(ROOT).filter((file) => {
    const rel = path.relative(ROOT, file);
    return !isIgnored(rel);
  });

  it("contains no sensitive token patterns in every tracked file", () => {
    expect(trackedFiles.length).toBeGreaterThan(0);

    // Deterministic full scan: no file is skipped.
    for (const file of trackedFiles) {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of sensitivePatterns) {
        pattern.lastIndex = 0;
        expect(pattern.test(content)).toBe(false);
      }
    }

    // Property-based check with 100 runs and full-coverage subset each run.
    fc.assert(
      fc.property(
        fc.shuffledSubarray(trackedFiles, {
          minLength: trackedFiles.length,
          maxLength: trackedFiles.length
        }),
        (files) =>
          files.every((file) => {
            const content = fs.readFileSync(file, "utf8");
            return sensitivePatterns.every((pattern) => {
              pattern.lastIndex = 0;
              return !pattern.test(content);
            });
          })
      ),
      { numRuns: 100 }
    );
  });

  it("ensures template files use placeholder values", () => {
    const checks: Array<[string, RegExp]> = [
      [".env.example", /NOTION_API_KEY=ntn_your_api_key_here/],
      [".env.example", /X_LIST_URL_1=https:\/\/x\.com\/i\/lists\/YOUR_LIST_ID/],
      ["info-skills/x-digest/sources.json.example", /YOUR_LIST_ID_1/],
      ["utility-skills/notion-sync/config.json.example", /YOUR_DATABASE_ID/]
    ];

    for (const [relPath, matcher] of checks) {
      const fullPath = path.join(ROOT, relPath);
      const content = fs.readFileSync(fullPath, "utf8");
      expect(content).toMatch(matcher);
    }
  });

  it("ensures daily-news-report template preserves core source schema", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "info-skills/daily-news-report/sources.json.example"),
      "utf8"
    );
    const parsed = JSON.parse(content);
    expect(parsed.sources?.tier1?.batch_a).toBeDefined();
    expect(parsed.sources?.tier1_hn_blogs?.feeds).toBeDefined();
    expect(Array.isArray(parsed.sources.tier1_hn_blogs.feeds)).toBe(true);
    expect(parsed.scoring?.dimensions?.relevance?.weight).toBe(0.4);
  });
});

