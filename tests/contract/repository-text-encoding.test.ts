import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { TextDecoder } from "node:util";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = process.cwd();
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".debug",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".ps1",
  ".ts",
  ".xml",
]);
const TEXT_FILENAMES = new Set([".gitignore"]);

function collectRepositoryTextFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...collectRepositoryTextFiles(join(directory, entry.name)));
      }
      continue;
    }

    if (TEXT_FILENAMES.has(entry.name) || TEXT_EXTENSIONS.has(extname(entry.name))) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

describe("repository text encoding", () => {
  it("keeps repository-authored text valid UTF-8", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const invalidFiles: string[] = [];

    for (const file of collectRepositoryTextFiles(REPOSITORY_ROOT)) {
      try {
        decoder.decode(readFileSync(file));
      } catch {
        invalidFiles.push(relative(REPOSITORY_ROOT, file));
      }
    }

    expect(invalidFiles).toEqual([]);
  });
});
