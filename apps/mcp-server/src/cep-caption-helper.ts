import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runtimePaths } from "./config.js";

const extensionId = "ai.brahma.yantra.caption-helper";
const maximumReadyAgeMs = 10_000;

export type CepCaptionHelperPaths = {
  commandPath: string;
  resultPath: string;
  readyPath: string;
};

export type CepCaptionHelperInput = {
  id: string;
  projectPath: string;
  sequenceName: string;
  sequenceId: string;
  srtPath: string;
  trackName: string;
  muted: boolean;
  expectedCaptionTracksBefore: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type CepCaptionHelperResult = {
  id: string;
  operation: "create_caption_track_from_srt";
  status: "pass" | "fail";
  outcome: Record<string, unknown>;
  completedAt: string;
};

const defaultPaths: CepCaptionHelperPaths = {
  commandPath: runtimePaths.cepCaptionCommand,
  resultPath: runtimePaths.cepCaptionResult,
  readyPath: runtimePaths.cepCaptionReady,
};

let helperQueue: Promise<void> = Promise.resolve();

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readCompletedResult(resultPath: string, id: string): Promise<CepCaptionHelperResult | null> {
  try {
    const value = record(await readJson(resultPath));
    if (!value || value.id !== id || (value.status !== "pass" && value.status !== "fail")) return null;
    const outcome = record(value.outcome);
    if (!outcome || typeof value.completedAt !== "string") throw new Error("CEP caption helper returned an invalid completed result");
    return {
      id,
      operation: "create_caption_track_from_srt",
      status: value.status,
      outcome,
      completedAt: value.completedAt,
    };
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return null;
    throw error;
  }
}

async function assertReady(readyPath: string): Promise<void> {
  const ready = record(await readJson(readyPath));
  if(ready?.noAutomaticSave!==true)throw Error('CEP_CAPTION_HELPER_UPDATE_REQUIRED: fully quit Premiere, run tests/live-premiere/install-cep-caption-helper.ps1 from the repository, reopen Premiere and verify helper 0.2.3+ readiness; UDT Reload alone cannot install CEP. Nothing dispatched');
  const updatedAt = typeof ready?.updatedAt === "string" ? Date.parse(ready.updatedAt) : Number.NaN;
  const ageMs = Date.now() - updatedAt;
  if (ready?.status !== "ready"
    || ready.extensionId !== extensionId
    || !Number.isFinite(updatedAt)
    || ageMs < -5_000
    || ageMs > maximumReadyAgeMs) {
    throw new Error(`CEP_CAPTION_HELPER_NOT_READY: ${JSON.stringify({ ready, ageMs })}`);
  }
}

export async function assertCaptionHelperReady():Promise<void>{await assertReady(defaultPaths.readyPath);}

/** Filesystem inspection only: never starts CEP or invokes Premiere. Installed
 * manifest and the running helper heartbeat are deliberately separate facts. */
export async function inspectCaptionHelperInstallation(options:{manifestPath?:string;readyPath?:string;now?:number}={}) {
  const manifestPath=options.manifestPath??path.join(process.env.APPDATA??'', 'Adobe/CEP/extensions',extensionId,'CSXS/manifest.xml');
  let installedVersion:string|null=null;
  try{installedVersion=(await readFile(manifestPath,'utf8')).match(/ExtensionBundleVersion="([^"]+)"/)?.[1]??null;}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  let ready:Record<string,unknown>|null=null;
  try{ready=record(await readJson(options.readyPath??defaultPaths.readyPath));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  const ageMs=(options.now??Date.now())-Date.parse(String(ready?.updatedAt));
  return {status:'pass',extensionId,installedVersion,loadedVersion:typeof ready?.version==='string'?ready.version:null,
    ready:ready?.extensionId===extensionId&&ready.status==='ready'&&Number.isFinite(ageMs)&&ageMs>=-5000&&ageMs<=maximumReadyAgeMs,
    noAutomaticSave:ready?.noAutomaticSave===true,
    updateProcedure:'Fully quit Premiere; run tests/live-premiere/install-cep-caption-helper.ps1 from the repository; reopen Premiere. UDT Reload does not install CEP.'};
}

async function writeJsonAtomic(destination: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, destination);
  } catch {
    await rm(destination, { force: true });
    await rename(temporary, destination);
  }
}

async function runOnce(input: CepCaptionHelperInput, paths: CepCaptionHelperPaths): Promise<CepCaptionHelperResult> {
  await assertReady(paths.readyPath);
  const existing = await readCompletedResult(paths.resultPath, input.id);
  if (existing) return existing;

  await writeJsonAtomic(paths.commandPath, {
    version: 1,
    saveProject: false,
    id: input.id,
    operation: "create_caption_track_from_srt",
    projectPath: input.projectPath,
    sequenceName: input.sequenceName,
    sequenceId: input.sequenceId,
    srtPath: input.srtPath,
    trackName: input.trackName,
    muted: input.muted,
    expectedCaptionTracksBefore: input.expectedCaptionTracksBefore,
    requestedAt: new Date().toISOString(),
  });

  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  do {
    await delay(pollIntervalMs);
    const completed = await readCompletedResult(paths.resultPath, input.id);
    if (completed) return completed;
  } while (Date.now() < deadline);

  throw new Error(`CEP_CAPTION_HELPER_TIMEOUT: no completed result for ${input.id}; inspect before retrying`);
}

export function runCepCaptionHelper(
  input: CepCaptionHelperInput,
  paths: CepCaptionHelperPaths = defaultPaths,
): Promise<CepCaptionHelperResult> {
  const execution = helperQueue.then(() => runOnce(input, paths));
  helperQueue = execution.then(() => undefined, () => undefined);
  return execution;
}
