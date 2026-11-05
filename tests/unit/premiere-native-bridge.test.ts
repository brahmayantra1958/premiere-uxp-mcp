import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cancelPremiereDeleteTracksDialogWithNativeBridge,
  deletePremiereEmptyTracksWithNativeBridge,
  invokePremiereNativeBridge,
  premiereNativeOperations,
  type PremiereNativeBridgeError,
  type PremiereNativeBridgeRunner,
} from "../../apps/mcp-server/src/premiere-native-bridge.js";
import { parsePremiereTasklistProcessIds } from "../../apps/mcp-server/src/system.js";

function acceptedRunner(capture: Array<Record<string, unknown>>): PremiereNativeBridgeRunner {
  return async (_executablePath, encodedRequest) => {
    const request = JSON.parse(Buffer.from(encodedRequest, "base64").toString("utf8")) as Record<string, unknown>;
    capture.push(request);
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        status: "pass",
        route: "premiere_win32_allowlisted_feature_bridge",
        protocolVersion: 1,
        operation: request.operation,
        premierePid: request.premierePid,
        premiereVersion: "26.3.0",
        mediaType: request.mediaType,
        expectedTrackCount: request.expectedTrackCount,
        expectedTrackNames: request.expectedTrackNames,
        command: {
          deleteTracks: 11630,
          deletePath: "Sequence > Delete Tracks",
        },
        dispatchState: "accepted_unverified",
        errors: [],
      }),
    };
  };
}

describe("allowlisted Premiere native feature bridge", () => {
  it("keeps the TypeScript and C# operation allowlists identical", async () => {
    const source = await readFile(path.resolve("apps/mcp-server/native/windows/PremiereFeatureBridge.cs"), "utf8");
    const nativeOperations = [...source.matchAll(/request\.operation == "([^"]+)"/g)].map((match) => match[1]);

    expect(nativeOperations).toEqual([...premiereNativeOperations]);
  });

  it("encodes only the fixed all-empty-tracks operation and exact expected set", async () => {
    const capture: Array<Record<string, unknown>> = [];
    const receipt = await deletePremiereEmptyTracksWithNativeBridge(44128, {
      mediaType: "caption",
      expectedTrackNames: ["EMPTY_CAPTION"],
    }, { runner: acceptedRunner(capture), executablePath: "bridge.exe" });

    expect(capture).toEqual([{
      protocolVersion: 1,
      operation: "delete_empty_tracks",
      premierePid: 44128,
      mediaType: "caption",
      expectedTrackCount: 1,
      expectedTrackNames: ["EMPTY_CAPTION"],
      timeoutMs: 5_000,
    }]);
    expect(receipt.command).toEqual({ deleteTracks: 11630, deletePath: "Sequence > Delete Tracks" });
  });

  it("rejects empty, blank, duplicate, or oversized track-name sets before launching the helper", async () => {
    const runner: PremiereNativeBridgeRunner = async () => {
      throw new Error("runner must not be called");
    };
    const options = { runner, executablePath: "bridge.exe" };

    expect(() => deletePremiereEmptyTracksWithNativeBridge(44128, { mediaType: "video", expectedTrackNames: [] }, options))
      .toThrowError("Expected track names must contain 1-64 unique non-empty names");
    expect(() => deletePremiereEmptyTracksWithNativeBridge(44128, { mediaType: "video", expectedTrackNames: [" "] }, options))
      .toThrowError("Expected track names must contain 1-64 unique non-empty names");
    expect(() => deletePremiereEmptyTracksWithNativeBridge(44128, { mediaType: "video", expectedTrackNames: ["V9", "V9"] }, options))
      .toThrowError("Expected track names must contain 1-64 unique non-empty names");
    expect(() => deletePremiereEmptyTracksWithNativeBridge(44128, { mediaType: "video", expectedTrackNames: Array.from({ length: 65 }, (_, index) => `V${index + 1}`) }, options))
      .toThrowError("Expected track names must contain 1-64 unique non-empty names");
  });

  it("encodes only the fixed delete-tracks dialog cancellation operation", async () => {
    const capture: Array<Record<string, unknown>> = [];
    await cancelPremiereDeleteTracksDialogWithNativeBridge(44128, {
      runner: acceptedRunner(capture),
      executablePath: "bridge.exe",
    });

    expect(capture).toEqual([{
      protocolVersion: 1,
      operation: "cancel_delete_tracks_dialog",
      premierePid: 44128,
      timeoutMs: 5_000,
    }]);
  });

  it("rejects a receipt whose process identity differs", async () => {
    const runner: PremiereNativeBridgeRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        status: "pass",
        route: "premiere_win32_allowlisted_feature_bridge",
        protocolVersion: 1,
        operation: "probe",
        premierePid: 999,
        dispatchState: "available",
        errors: [],
      }),
    });
    await expect(invokePremiereNativeBridge({
      protocolVersion: 1,
      operation: "probe",
      premierePid: 44128,
      timeoutMs: 5_000,
    }, { runner, executablePath: "bridge.exe" })).rejects.toMatchObject<Partial<PremiereNativeBridgeError>>({
      code: "NATIVE_BRIDGE_RECEIPT_MISMATCH",
    });
  });

  it("rejects a passing receipt that omits the fixed command identity", async () => {
    const runner: PremiereNativeBridgeRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        status: "pass",
        route: "premiere_win32_allowlisted_feature_bridge",
        protocolVersion: 1,
        operation: "probe",
        premierePid: 44128,
        premiereVersion: "26.3.0",
        dispatchState: "available",
        errors: [],
      }),
    });
    await expect(invokePremiereNativeBridge({
      protocolVersion: 1,
      operation: "probe",
      premierePid: 44128,
      timeoutMs: 5_000,
    }, { runner, executablePath: "bridge.exe" })).rejects.toMatchObject<Partial<PremiereNativeBridgeError>>({
      code: "NATIVE_BRIDGE_RECEIPT_MISMATCH",
    });
  });

  it("parses exact Premiere process rows without accepting other Adobe executables", () => {
    expect(parsePremiereTasklistProcessIds([
      '"Adobe Premiere Pro.exe","44128","Console","1","4,919,120 K"',
      '"Adobe Media Encoder.exe","777","Console","1","100 K"',
      '"Adobe Premiere Pro.exe","55100","Console","1","5,000 K"',
    ].join("\r\n"))).toEqual([44128, 55100]);
  });
});
