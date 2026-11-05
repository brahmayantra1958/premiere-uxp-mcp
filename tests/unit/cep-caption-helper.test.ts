import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { runCepCaptionHelper, inspectCaptionHelperInstallation, type CepCaptionHelperPaths } from "../../apps/mcp-server/src/cep-caption-helper";
import {freshTestDirectory} from '../helpers/workspace.js';

it('separates installed caption helper version from an old running heartbeat',async()=>{
  const root=await freshTestDirectory('helper-version'),manifestPath=path.join(root,'manifest.xml'),readyPath=path.join(root,'ready.json'),now=Date.now();
  await writeFile(manifestPath,'<ExtensionManifest ExtensionBundleVersion="0.2.3"/>');
  await writeFile(readyPath,JSON.stringify({version:'0.2.2',extensionId:'ai.brahma.yantra.caption-helper',status:'ready',updatedAt:new Date(now-20000).toISOString()}));
  expect(await inspectCaptionHelperInstallation({manifestPath,readyPath,now})).toMatchObject({status:'pass',installedVersion:'0.2.3',loadedVersion:'0.2.2',ready:false,noAutomaticSave:false});
});

async function fixture(): Promise<{ root: string; paths: CepCaptionHelperPaths }> {
  const root = await mkdtemp(path.join(tmpdir(), "premiere-cep-caption-"));
  const paths = {
    commandPath: path.join(root, "command.json"),
    resultPath: path.join(root, "result.json"),
    readyPath: path.join(root, "ready.json"),
  };
  await mkdir(root, { recursive: true });
  return { root, paths };
}

async function writeReady(paths: CepCaptionHelperPaths, updatedAt = new Date().toISOString()): Promise<void> {
  await writeFile(paths.readyPath, JSON.stringify({
    status: "ready",
    noAutomaticSave: true,
    extensionId: "ai.brahma.yantra.caption-helper",
    updatedAt,
  }), "utf8");
}

async function waitForCommand(filePath: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 2_000;
  do {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    } catch {
      await delay(10);
    }
  } while (Date.now() < deadline);
  throw new Error("Caption command was not written");
}

describe("CEP caption helper bridge", () => {
  it("sends one bounded caption command and waits for the matching completed result", async () => {
    const { root, paths } = await fixture();
    try {
      await writeReady(paths);
      const input = {
        id: "7f5f73d4-861e-4cf9-81d3-982354a5488a",
        projectPath: "C:\\scratch\\working.prproj",
        sequenceName: "CAPTION_TEST",
        sequenceId: "sequence-id",
        srtPath: "C:\\scratch\\captions.srt",
        trackName: "English Narration",
        muted: true,
        expectedCaptionTracksBefore: 1,
        timeoutMs: 2_000,
        pollIntervalMs: 10,
      };
      const pending = runCepCaptionHelper(input, paths);
      const command = await waitForCommand(paths.commandPath);
      expect(command).toMatchObject({
        version: 1,
        id: input.id,
        operation: "create_caption_track_from_srt",
        projectPath: input.projectPath,
        sequenceName: input.sequenceName,
        srtPath: input.srtPath,
        trackName: "English Narration",
        muted: true,
        expectedCaptionTracksBefore: 1,
      });

      await writeFile(paths.resultPath, JSON.stringify({
        id: input.id,
        operation: "create_caption_track_from_srt",
        status: "pass",
        outcome: { ok: true, code: "CAPTION_TRACK_CREATED" },
        completedAt: "2026-08-25T03:00:00.000Z",
      }), "utf8");

      await expect(pending).resolves.toMatchObject({
        id: input.id,
        status: "pass",
        outcome: { ok: true, code: "CAPTION_TRACK_CREATED" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a stale helper heartbeat before writing a command", async () => {
    const { root, paths } = await fixture();
    try {
      await writeReady(paths, "2026-08-24T00:00:00.000Z");
      await expect(runCepCaptionHelper({
        id: "a14aecc0-b953-470f-9285-0d73c6e294e1",
        projectPath: "C:\\scratch\\working.prproj",
        sequenceName: "CAPTION_TEST",
        sequenceId: "sequence-id",
        srtPath: "C:\\scratch\\captions.srt",
        trackName: "English Narration",
        muted: false,
        expectedCaptionTracksBefore: 0,
        timeoutMs: 50,
        pollIntervalMs: 5,
      }, paths)).rejects.toThrow("CEP_CAPTION_HELPER_NOT_READY");
      await expect(access(paths.commandPath)).rejects.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses a completed result with the same id without issuing a duplicate command", async () => {
    const { root, paths } = await fixture();
    try {
      await writeReady(paths);
      const id = "fb8604e8-870f-4558-bddf-5af7098c2827";
      await writeFile(paths.resultPath, JSON.stringify({
        id,
        operation: "create_caption_track_from_srt",
        status: "pass",
        outcome: { ok: true, code: "CAPTION_TRACK_CREATED" },
        completedAt: "2026-08-25T03:00:00.000Z",
      }), "utf8");

      await expect(runCepCaptionHelper({
        id,
        projectPath: "C:\\scratch\\working.prproj",
        sequenceName: "CAPTION_TEST",
        sequenceId: "sequence-id",
        srtPath: "C:\\scratch\\captions.srt",
        trackName: "English Narration",
        muted: true,
        expectedCaptionTracksBefore: 0,
      }, paths)).resolves.toMatchObject({ id, status: "pass" });
      await expect(access(paths.commandPath)).rejects.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
