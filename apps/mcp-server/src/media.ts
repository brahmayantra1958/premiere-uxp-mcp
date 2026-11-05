import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { DeliveryReport } from "@premiere-uxp/contracts";
import {mediaExecutable} from "./media-tools.js";

const execFileAsync = promisify(execFile);

// FFmpeg's pic_th is the required ratio of black pixels in a black frame;
// pix_th is the maximum luma of each black pixel. Keeping both explicit avoids
// accidentally swapping their very different defaults (0.98 versus 0.10).
export const BLACKDETECT_FILTER = "blackdetect=d=0.5:pic_th=0.98:pix_th=0.10";

export type DeliveryRequirements = Readonly<{
  minimumWidth?: number;
  maximumWidth?: number;
  aspectRatio?: number;
  aspectTolerance?: number;
  minimumDurationSeconds?: number;
  requireAudio?: boolean;
  offlineMediaCount?: number;
  requireContentScan?: boolean;
}>;

export type ProxyPlan = Readonly<{
  inputPath: string;
  outputPath: string;
  inputSizeBytes: number;
  inputDurationSeconds?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  targetWidth: number;
  estimatedOutputBytesLow: number;
  estimatedOutputBytesHigh: number;
  estimateMethod: string;
}>;

export const culturalHeritageRequirements: DeliveryRequirements = {
  minimumWidth: 2_048,
  maximumWidth: 4_096,
  aspectRatio: 16 / 9,
  aspectTolerance: 0.01,
  minimumDurationSeconds: 120,
  requireAudio: true,
  requireContentScan: true,
};

function rational(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numerator, denominator] = value.split("/").map(Number);
  if (numerator === undefined || denominator === undefined || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  return numerator / denominator;
}

function requirement(requirement: string, status: DeliveryReport["status"], actual?: unknown) {
  return { requirement, status, ...(actual === undefined ? {} : { actual }) };
}

function parseBlackIntervals(stderr: string): Array<{ startSeconds: number; endSeconds: number }> {
  return [...stderr.matchAll(/black_start:([0-9.]+)\s+black_end:([0-9.]+)/g)].map((match) => ({ startSeconds: Number(match[1]), endSeconds: Number(match[2]) }));
}

function parseSilenceIntervals(stderr: string, durationSeconds: number): Array<{ startSeconds: number; endSeconds: number }> {
  const events = [...stderr.matchAll(/silence_(start|end):\s*([0-9.]+)/g)];
  const intervals: Array<{ startSeconds: number; endSeconds: number }> = [];
  let start: number | undefined;
  for (const event of events) {
    const value = Number(event[2]);
    if (event[1] === "start") start = value;
    else if (start !== undefined) { intervals.push({ startSeconds: start, endSeconds: value }); start = undefined; }
  }
  if (start !== undefined) intervals.push({ startSeconds: start, endSeconds: durationSeconds });
  return intervals;
}

async function scanContent(filePath: string, hasVideo: boolean, hasAudio: boolean, durationSeconds: number) {
  let blackFrameIntervals: Array<{ startSeconds: number; endSeconds: number }> = [];
  let silenceIntervals: Array<{ startSeconds: number; endSeconds: number }> = [];
  if (hasVideo) {
    const { stderr } = await execFileAsync(mediaExecutable("ffmpeg"), [
      "-hide_banner", "-nostdin", "-i", filePath, "-vf", BLACKDETECT_FILTER, "-an", "-f", "null", "NUL",
    ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    blackFrameIntervals = parseBlackIntervals(stderr);
  }
  if (hasAudio) {
    const { stderr } = await execFileAsync(mediaExecutable("ffmpeg"), [
      "-hide_banner", "-nostdin", "-i", filePath, "-af", "silencedetect=noise=-50dB:d=1", "-vn", "-f", "null", "NUL",
    ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    silenceIntervals = parseSilenceIntervals(stderr, durationSeconds);
  }
  return { blackFrameIntervals, silenceIntervals };
}

export async function probeDelivery(filePath: string, requirements: DeliveryRequirements = {}, analyzeContent = false): Promise<DeliveryReport> {
  let file: Awaited<ReturnType<typeof stat>>;
  try {
    file = await stat(filePath);
  } catch (error) {
    return {
      path: filePath,
      exists: false,
      codecs: [],
      audioStreams: 0,
      blackFrameIntervals: [],
      silenceIntervals: [],
      requirementResults: [],
      status: "fail",
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  try {
    const { stdout } = await execFileAsync(mediaExecutable("ffprobe"), [
      "-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath,
    ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    const result = JSON.parse(stdout) as {
      format?: { format_name?: string; duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string }>;
    };
    const streams = result.streams ?? [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const durationSeconds = result.format?.duration ? Number(result.format.duration) : undefined;
    const requirementResults: DeliveryReport["requirementResults"] = [];
    if (requirements.minimumWidth !== undefined) requirementResults.push(requirement(`width >= ${requirements.minimumWidth}`, video?.width !== undefined && video.width >= requirements.minimumWidth ? "pass" : "fail", video?.width));
    if (requirements.maximumWidth !== undefined) requirementResults.push(requirement(`width <= ${requirements.maximumWidth}`, video?.width !== undefined && video.width <= requirements.maximumWidth ? "pass" : "fail", video?.width));
    if (requirements.aspectRatio !== undefined) {
      const actual = video?.width !== undefined && video?.height !== undefined ? video.width / video.height : undefined;
      const tolerance = requirements.aspectTolerance ?? 0.001;
      requirementResults.push(requirement(`aspect ratio ${requirements.aspectRatio}`, actual !== undefined && Math.abs(actual - requirements.aspectRatio) <= tolerance ? "pass" : "fail", actual));
    }
    if (requirements.minimumDurationSeconds !== undefined) requirementResults.push(requirement(`duration >= ${requirements.minimumDurationSeconds}s`, durationSeconds !== undefined && durationSeconds >= requirements.minimumDurationSeconds ? "pass" : "fail", durationSeconds));
    const audioStreams = streams.filter((stream) => stream.codec_type === "audio").length;
    if (requirements.requireAudio) requirementResults.push(requirement("at least one audio stream", audioStreams > 0 ? "pass" : "fail", audioStreams));
    if (requirements.offlineMediaCount !== undefined) requirementResults.push(requirement("no offline project media", requirements.offlineMediaCount === 0 ? "pass" : "fail", requirements.offlineMediaCount));
    else if (Object.keys(requirements).length) requirementResults.push(requirement("no offline project media", "unverified"));

    let blackFrameIntervals: DeliveryReport["blackFrameIntervals"] = [];
    let silenceIntervals: DeliveryReport["silenceIntervals"] = [];
    const errors: string[] = [];
    if (analyzeContent) {
      try {
        ({ blackFrameIntervals, silenceIntervals } = await scanContent(filePath, Boolean(video), audioStreams > 0, durationSeconds ?? 0));
        requirementResults.push(requirement("black-frame scan", !video ? "unverified" : blackFrameIntervals.length ? "partial" : "pass", blackFrameIntervals));
        requirementResults.push(requirement("silence scan", audioStreams === 0 ? "unverified" : silenceIntervals.length ? "partial" : "pass", silenceIntervals));
      } catch (error) {
        errors.push(`Content scan failed: ${error instanceof Error ? error.message : String(error)}`);
        requirementResults.push(requirement("black-frame scan", "unverified"));
        requirementResults.push(requirement("silence scan", "unverified"));
      }
    } else if (requirements.requireContentScan) {
      requirementResults.push(requirement("black-frame scan", "unverified"));
      requirementResults.push(requirement("silence scan", "unverified"));
    }
    const status: DeliveryReport["status"] = requirementResults.some((item) => item.status === "fail")
      ? "fail"
      : requirementResults.some((item) => item.status === "partial" || item.status === "unverified") ? "partial" : "pass";
    return {
      path: filePath,
      exists: true,
      codecs: streams.flatMap((stream) => stream.codec_name ? [stream.codec_name] : []),
      audioStreams,
      sizeBytes: file.size,
      blackFrameIntervals,
      silenceIntervals,
      requirementResults,
      status,
      errors,
      ...(result.format?.format_name === undefined ? {} : { container: result.format.format_name }),
      ...(video?.width === undefined ? {} : { width: video.width }),
      ...(video?.height === undefined ? {} : { height: video.height }),
      ...(video?.width === undefined || video?.height === undefined ? {} : { aspectRatio: video.width / video.height }),
      ...(rational(video?.avg_frame_rate) === undefined ? {} : { frameRate: rational(video?.avg_frame_rate) as number }),
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      ...(requirements.offlineMediaCount === undefined ? {} : { offlineMediaCount: requirements.offlineMediaCount }),
    };
  } catch (error) {
    return {
      path: filePath,
      exists: true,
      codecs: [],
      audioStreams: 0,
      sizeBytes: file.size,
      blackFrameIntervals: [],
      silenceIntervals: [],
      requirementResults: [],
      status: "fail",
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function planProxy(inputPath: string, outputPath: string): Promise<ProxyPlan> {
  const report = await probeDelivery(inputPath);
  if (!report.exists || report.status === "fail" || report.sizeBytes === undefined) throw new Error(`Cannot plan proxy for unreadable input: ${inputPath}`);
  if (report.width === undefined || report.height === undefined) throw new Error(`Proxy input has no readable video stream: ${inputPath}`);
  const targetWidth = Math.min(1_280, report.width ?? 1_280);
  const pixelRatio = report.width && report.height ? Math.min(1, (targetWidth * targetWidth * report.height / report.width) / (report.width * report.height)) : 0.5;
  const baseline = report.sizeBytes * Math.max(0.08, pixelRatio);
  return {
    inputPath,
    outputPath,
    inputSizeBytes: report.sizeBytes,
    ...(report.durationSeconds === undefined ? {} : { inputDurationSeconds: report.durationSeconds }),
    ...(report.width === undefined ? {} : { sourceWidth: report.width }),
    ...(report.height === undefined ? {} : { sourceHeight: report.height }),
    targetWidth,
    estimatedOutputBytesLow: Math.round(baseline * 0.35),
    estimatedOutputBytesHigh: Math.round(baseline * 1.5),
    estimateMethod: "Heuristic range from source size and target pixel ratio; CRF output is content-dependent.",
  };
}

export async function createProxy(inputPath: string, outputPath: string, plan?: ProxyPlan): Promise<{ plan: ProxyPlan; inputPath: string; outputPath: string; elapsedMs: number; processingRate: number | undefined; report: DeliveryReport }> {
  const proxyPlan = plan ?? await planProxy(inputPath, outputPath);
  const started = performance.now();
  await execFileAsync(mediaExecutable("ffmpeg"), [
    "-hide_banner", "-nostdin", "-n", "-i", inputPath,
    "-vf", "scale='min(1280,iw)':-2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath,
  ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  const elapsedMs = performance.now() - started;
  const report = await probeDelivery(outputPath);
  return {
    plan: proxyPlan,
    inputPath,
    outputPath,
    elapsedMs,
    processingRate: proxyPlan.inputDurationSeconds === undefined || elapsedMs === 0 ? undefined : proxyPlan.inputDurationSeconds / (elapsedMs / 1_000),
    report,
  };
}
