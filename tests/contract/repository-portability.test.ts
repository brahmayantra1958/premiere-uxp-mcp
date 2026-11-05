import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoots = ["apps", "docs", "packages", "scripts", "tests"];
const textExtensions = new Set([".js", ".jsx", ".json", ".md", ".mjs", ".ps1", ".ts"]);

async function textFiles(candidate: string): Promise<string[]> {
  const metadata = await stat(candidate);
  if (metadata.isFile()) return textExtensions.has(path.extname(candidate).toLowerCase()) ? [candidate] : [];
  const entries = await readdir(candidate, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter((entry) => !["artifacts", "dist", "node_modules"].includes(entry.name))
    .map((entry) => textFiles(path.join(candidate, entry.name))));
  return nested.flat();
}

describe("repository portability contract", () => {
  it("does not contain retired or legacy absolute checkout paths", async () => {
    const retiredRoot = ["C:", "Users", "user", "Documents", "00 Agent", "03 Personal-Inventions", "premiere-uxp"].join("\\");
    const legacyDrive = `${String.fromCharCode(69)}:`;
    const legacyRoot = [legacyDrive, "조영서(21'~25')", "dev", "dev-260728", "00 Agent", "03 Personal-Inventions", "premiere-uxp"].join("\\");
    const files = (await Promise.all(sourceRoots.map((root) => textFiles(path.resolve(root))))).flat();
    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      if ([retiredRoot, legacyRoot].some((root) => content.includes(root) || content.includes(root.replaceAll("\\", "\\\\")))) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
