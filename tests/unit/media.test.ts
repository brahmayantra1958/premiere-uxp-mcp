import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { BLACKDETECT_FILTER, createProxy, culturalHeritageRequirements, probeDelivery } from "../../apps/mcp-server/src/media.js";
import { freshTestDirectory } from "../helpers/workspace.js";
import {mediaExecutable} from "../../apps/mcp-server/src/media-tools.js";

const execFileAsync = promisify(execFile);
// This is an optional real FFmpeg integration check, not a core UXP prerequisite.
const hasMediaTools = ['ffmpeg', 'ffprobe'].every(tool => spawnSync(mediaExecutable(tool as 'ffmpeg' | 'ffprobe'), ['-version'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }).status === 0);

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

describe("local media evidence", () => {
  it("keeps FFmpeg's frame-ratio and pixel-luma black thresholds distinct", () => {
    expect(BLACKDETECT_FILTER).toBe("blackdetect=d=0.5:pic_th=0.98:pix_th=0.10");
    expect(BLACKDETECT_FILTER).not.toContain("pix_th=0.98");
  });

  it.skipIf(!hasMediaTools)("probes a generated test fixture and creates a smaller local proxy without changing its input", async () => {
    const directory = await freshTestDirectory("media");
    const input = path.join(directory, "fixture.mp4");
    const output = path.join(directory, "proxy.mp4");
    await execFileAsync(mediaExecutable("ffmpeg"), [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=24:duration=1",
      "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=1",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", input,
    ], { windowsHide: true });
    const before = await probeDelivery(input);
    const beforeHash = await hashFile(input);
    const proxy = await createProxy(input, output);
    const after = await probeDelivery(input);
    expect(before).toMatchObject({ exists: true, width: 1920, height: 1080, audioStreams: 1, status: "pass" });
    expect(proxy.report).toMatchObject({ exists: true, width: 1280, height: 720, audioStreams: 1, status: "pass" });
    expect(after.sizeBytes).toBe(before.sizeBytes);
    expect(await hashFile(input)).toBe(beforeHash);
    expect(after.durationSeconds).toBeCloseTo(before.durationSeconds!, 2);
    const culturalQc = await probeDelivery(input, { ...culturalHeritageRequirements, offlineMediaCount: 0 }, true);
    expect(culturalQc.status).toBe("fail");
    expect(culturalQc.requirementResults.find((item) => item.requirement === "black-frame scan")?.status).toBe("pass");
    expect(culturalQc.requirementResults.find((item) => item.requirement === "duration >= 120s")?.status).toBe("fail");
  });

  it("reports a missing exported file as fail", async () => {
    const directory = await freshTestDirectory("media-missing");
    await expect(probeDelivery(path.join(directory, "not-created.mp4"))).resolves.toMatchObject({ exists: false, status: "fail" });
  });

  it("keeps file-existence evidence true when ffprobe rejects a corrupt artifact", async () => {
    const directory = await freshTestDirectory("media-corrupt");
    const corrupt = path.join(directory, "corrupt.mp4");
    await writeFile(corrupt, "not media", "utf8");
    await expect(probeDelivery(corrupt)).resolves.toMatchObject({ exists: true, status: "fail", sizeBytes: 9 });
  });
});
