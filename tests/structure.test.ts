import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

describe("info-agent-plugin structure checks", () => {
  it("validates plugin.json shape", () => {
    const pluginPath = path.join(ROOT, "plugin.json");
    const plugin = JSON.parse(fs.readFileSync(pluginPath, "utf8"));

    expect(plugin.name).toBe("info-agent-plugin");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin.author).toBeTruthy();
    expect(plugin.repository).toMatch(/^https:\/\/github\.com\/.+\/info-agent-plugin$/);
    expect(Array.isArray(plugin.skills)).toBe(true);
    expect(plugin.skills.length).toBe(6);
    expect(plugin.shared?.path).toBe("_shared");
    expect(Array.isArray(plugin.dependencies?.shared)).toBe(true);
    expect(plugin.dependencies.shared.length).toBeGreaterThan(0);

    for (const skill of plugin.skills) {
      const skillPath = path.join(ROOT, skill.path);
      expect(fs.existsSync(skillPath)).toBe(true);
    }
  });

  it("ensures .gitignore contains required exclusion patterns", () => {
    const content = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    const requiredPatterns = [
      "**/.env",
      "**/sources.json",
      "**/config.json",
      "**/cache.json",
      "**/sync-history.json",
      "**/EXTEND.md",
      "output_info/",
      "node_modules/"
    ];

    for (const pattern of requiredPatterns) {
      expect(content).toContain(pattern);
    }
  });

  it("verifies required files exist in each skill directory", () => {
    const requiredFiles = [
      "info-skills/daily-news-report/SKILL.md",
      "info-skills/daily-news-report/sources.json.example",
      "info-skills/daily-news-report/EXTEND.md.example",
      "info-skills/x-digest/SKILL.md",
      "info-skills/x-digest/sources.json.example",
      "info-skills/x-digest/EXTEND.md.example",
      "info-skills/github-search/SKILL.md",
      "info-skills/github-search/config.json.example",
      "info-skills/github-search/EXTEND.md.example",
      "info-skills/info-collector/SKILL.md",
      "info-skills/info-collector/config.json.example",
      "info-skills/info-collector/EXTEND.md.example",
      "utility-skills/url-to-markdown/SKILL.md",
      "utility-skills/url-to-markdown/scripts/fetch-jina.js",
      "utility-skills/url-to-markdown/EXTEND.md.example",
      "utility-skills/notion-sync/SKILL.md",
      "utility-skills/notion-sync/config.json.example",
      "utility-skills/notion-sync/EXTEND.md.example"
    ];

    for (const rel of requiredFiles) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  it("verifies README contains required sections", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const requiredSections = [
      "Plugin Overview",
      "目录结构",
      "Installation",
      "环境变量配置",
      "Skill Usage Examples",
      "EXTEND.md",
      "Migration Guide",
      "迁移"
    ];

    for (const section of requiredSections) {
      expect(readme).toContain(section);
    }
  });
});
