import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

export const testArtifactsRoot = path.resolve("artifacts", "tests");

export async function freshTestDirectory(name: string): Promise<string> {
  const directory = path.join(testArtifactsRoot, name);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  return directory;
}
