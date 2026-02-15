import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function listSkillFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listSkillFiles(full));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      result.push(full);
    }
  }
  return result;
}

function extractRelativeLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].trim();
    const isPlaceholder =
      target === "URL" ||
      target === "搜索URL" ||
      target.includes("{") ||
      target.includes("}");

    if (
      !target ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("#") ||
      isPlaceholder
    ) {
      continue;
    }
    links.push(target);
  }
  return links;
}

describe("Feature: info-agent-plugin, Property 2: SKILL.md 中所有相对路径引用指向存在的文件", () => {
  const skillFiles = listSkillFiles(ROOT);
  const checks = skillFiles.flatMap((skillFile) => {
    const content = fs.readFileSync(skillFile, "utf8");
    const targets = extractRelativeLinks(content);
    return targets.map((target) => ({
      from: skillFile,
      target,
      resolved: path.resolve(path.dirname(skillFile), target)
    }));
  });

  it("resolves every relative markdown link to an existing file", () => {
    expect(skillFiles.length).toBeGreaterThan(0);
    expect(checks.length).toBeGreaterThan(0);

    // Deterministic full scan: verify all extracted links.
    for (const check of checks) {
      expect(fs.existsSync(check.resolved)).toBe(true);
    }

    // Property-based check with 100 full-coverage runs.
    fc.assert(
      fc.property(
        fc.shuffledSubarray(checks, { minLength: checks.length, maxLength: checks.length }),
        (subset) => subset.every((check) => fs.existsSync(check.resolved))
      ),
      { numRuns: 100 }
    );
  });
});
