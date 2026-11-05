import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PremiereProcessState = "running" | "not_running" | "unknown";

export function parsePremiereTasklistProcessIds(stdout: string): number[] {
  const processIds = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^"Adobe Premiere Pro\.exe","(\d+)"/i);
    if (!match) continue;
    const processId = Number(match[1]);
    if (Number.isSafeInteger(processId) && processId > 0) processIds.add(processId);
  }
  return [...processIds].sort((a, b) => a - b);
}

export async function detectPremiereProcessIds(): Promise<number[]> {
  if (process.platform !== "win32") return [];
  const { stdout } = await execFileAsync("tasklist.exe", ["/FI", "IMAGENAME eq Adobe Premiere Pro.exe", "/FO", "CSV", "/NH"], {
    windowsHide: true,
    timeout: 2_000,
  });
  return parsePremiereTasklistProcessIds(stdout);
}

export async function detectPremiereProcess(): Promise<PremiereProcessState> {
  if (process.platform !== "win32") return "unknown";
  try {
    return (await detectPremiereProcessIds()).length ? "running" : "not_running";
  } catch {
    return "unknown";
  }
}
