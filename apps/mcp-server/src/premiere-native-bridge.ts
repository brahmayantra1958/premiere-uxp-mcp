import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { detectPremiereProcessIds } from "./system.js";

export const premiereNativeOperations = ["probe", "delete_empty_tracks", "cancel_delete_tracks_dialog"] as const;

const bridgeResponseSchema = z.object({
  status: z.enum(["pass", "fail"]),
  route: z.literal("premiere_win32_allowlisted_feature_bridge"),
  protocolVersion: z.number().int().optional(),
  operation: z.enum(premiereNativeOperations).optional(),
  premierePid: z.number().int().positive().optional(),
  premiereVersion: z.string().optional(),
  mediaType: z.enum(["video", "audio", "caption"]).nullable().optional(),
  expectedTrackCount: z.number().int().nonnegative().optional(),
  expectedTrackNames: z.array(z.string()).nullable().optional(),
  command: z.object({
    deleteTracks: z.literal(11630),
    deletePath: z.string().min(1),
  }).optional(),
  dispatchState: z.enum(["available", "accepted_unverified"]).optional(),
  errors: z.array(z.string()),
}).passthrough();

export type PremiereNativeBridgeResponse = z.infer<typeof bridgeResponseSchema>;
export type PremiereNativeMediaType = "video" | "audio" | "caption";

type NativeBridgeRequest = {
  protocolVersion: 1;
  operation: typeof premiereNativeOperations[number];
  premierePid: number;
  mediaType?: PremiereNativeMediaType;
  expectedTrackCount?: number;
  expectedTrackNames?: string[];
  timeoutMs: number;
};

type ProcessResult = { exitCode: number | null; stdout: string; stderr: string };
export type PremiereNativeBridgeRunner = (
  executablePath: string,
  encodedRequest: string,
  timeoutMs: number,
) => Promise<ProcessResult>;

export class PremiereNativeBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PremiereNativeBridgeError";
  }
}

export function defaultPremiereNativeBridgePath(): string {
  return fileURLToPath(new URL("../native/windows/bin/PremiereFeatureBridge.exe", import.meta.url));
}

const defaultRunner: PremiereNativeBridgeRunner = (executablePath, encodedRequest, timeoutMs) => new Promise((resolve) => {
  execFile(executablePath, ["--request-base64", encodedRequest], {
    encoding: "utf8",
    windowsHide: true,
    // The helper has separate bounded phases for opening, driving, and closing
    // the Premiere modal. The parent timeout must cover those phases so a
    // structured fail receipt is not truncated by an early process kill.
    timeout: timeoutMs * 3 + 2_000,
    maxBuffer: 1024 * 1024,
  }, (error, stdout, stderr) => {
    const exitCode = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
    const diagnostic = error instanceof Error ? error.message : error ? String(error) : "";
    resolve({ exitCode, stdout: String(stdout), stderr: String(stderr) || diagnostic });
  });
});

function encodedRequest(request: NativeBridgeRequest): string {
  return Buffer.from(JSON.stringify(request), "utf8").toString("base64");
}

export async function resolveSinglePremiereProcessId(): Promise<number> {
  const processIds = await detectPremiereProcessIds();
  if (processIds.length === 0) throw new PremiereNativeBridgeError("PREMIERE_NOT_RUNNING", "No running Adobe Premiere Pro process was found");
  if (processIds.length !== 1) {
    throw new PremiereNativeBridgeError("AMBIGUOUS_PREMIERE_PROCESS", `Expected one Adobe Premiere Pro process, found ${processIds.join(", ")}`);
  }
  const [processId] = processIds;
  if (processId == null) throw new PremiereNativeBridgeError("PREMIERE_NOT_RUNNING", "No running Adobe Premiere Pro process was found");
  return processId;
}

export async function invokePremiereNativeBridge(
  request: NativeBridgeRequest,
  options: { executablePath?: string; runner?: PremiereNativeBridgeRunner } = {},
): Promise<PremiereNativeBridgeResponse> {
  if (process.platform !== "win32" && !options.runner) {
    throw new PremiereNativeBridgeError("WINDOWS_REQUIRED", "The Premiere native feature bridge is available only on Windows");
  }
  const runner = options.runner ?? defaultRunner;
  const result = await runner(options.executablePath ?? defaultPremiereNativeBridgePath(), encodedRequest(request), request.timeoutMs);
  let response: PremiereNativeBridgeResponse;
  try {
    response = bridgeResponseSchema.parse(JSON.parse(result.stdout));
  } catch (error) {
    throw new PremiereNativeBridgeError(
      "INVALID_NATIVE_BRIDGE_RESPONSE",
      `Premiere native bridge returned invalid JSON (${result.exitCode}): ${result.stderr || (error instanceof Error ? error.message : String(error))}`,
    );
  }
  if (response.status !== "pass" || result.exitCode !== 0) {
    throw new PremiereNativeBridgeError(
      "NATIVE_BRIDGE_REJECTED",
      response.errors.join("; ") || `Premiere native bridge exited with code ${result.exitCode}`,
    );
  }
  if (response.protocolVersion !== 1 || response.operation !== request.operation || response.premierePid !== request.premierePid) {
    throw new PremiereNativeBridgeError("NATIVE_BRIDGE_RECEIPT_MISMATCH", "Premiere native bridge receipt did not match the request identity");
  }
  if (!response.command) {
    throw new PremiereNativeBridgeError("NATIVE_BRIDGE_RECEIPT_MISMATCH", "Premiere native bridge receipt omitted the fixed Delete Tracks command identity");
  }
  const expectedDispatchState = request.operation === "probe" ? "available" : "accepted_unverified";
  if (response.dispatchState !== expectedDispatchState) {
    throw new PremiereNativeBridgeError("NATIVE_BRIDGE_RECEIPT_MISMATCH", "Premiere native bridge receipt did not match the expected dispatch state");
  }
  if (request.mediaType !== undefined && response.mediaType !== request.mediaType) {
    throw new PremiereNativeBridgeError("NATIVE_BRIDGE_RECEIPT_MISMATCH", "Premiere native bridge receipt did not match the requested media type");
  }
  if (request.expectedTrackCount !== undefined && response.expectedTrackCount !== request.expectedTrackCount) {
    throw new PremiereNativeBridgeError("NATIVE_BRIDGE_RECEIPT_MISMATCH", "Premiere native bridge receipt did not match the expected track count");
  }
  if (request.expectedTrackNames !== undefined
    && JSON.stringify(response.expectedTrackNames) !== JSON.stringify(request.expectedTrackNames)) {
    throw new PremiereNativeBridgeError("NATIVE_BRIDGE_RECEIPT_MISMATCH", "Premiere native bridge receipt did not match the expected track names");
  }
  return response;
}

export function probePremiereNativeBridge(
  premierePid: number,
  options: { executablePath?: string; runner?: PremiereNativeBridgeRunner } = {},
): Promise<PremiereNativeBridgeResponse> {
  return invokePremiereNativeBridge({
    protocolVersion: 1,
    operation: "probe",
    premierePid,
    timeoutMs: 5_000,
  }, options);
}

export function deletePremiereEmptyTracksWithNativeBridge(
  premierePid: number,
  target: { mediaType: PremiereNativeMediaType; expectedTrackNames: string[] },
  options: { executablePath?: string; runner?: PremiereNativeBridgeRunner } = {},
): Promise<PremiereNativeBridgeResponse> {
  const names = target.expectedTrackNames;
  if (names.length === 0 || names.length > 64 || names.some((name) => !name.trim()) || new Set(names).size !== names.length) {
    throw new PremiereNativeBridgeError("INVALID_EXPECTED_TRACK_NAMES", "Expected track names must contain 1-64 unique non-empty names");
  }
  return invokePremiereNativeBridge({
    protocolVersion: 1,
    operation: "delete_empty_tracks",
    premierePid,
    mediaType: target.mediaType,
    expectedTrackCount: names.length,
    expectedTrackNames: names,
    timeoutMs: 5_000,
  }, options);
}

export function cancelPremiereDeleteTracksDialogWithNativeBridge(
  premierePid: number,
  options: { executablePath?: string; runner?: PremiereNativeBridgeRunner } = {},
): Promise<PremiereNativeBridgeResponse> {
  return invokePremiereNativeBridge({
    protocolVersion: 1,
    operation: "cancel_delete_tracks_dialog",
    premierePid,
    timeoutMs: 5_000,
  }, options);
}
