import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { prepareClipEdit } from "../../apps/mcp-server/src/prepare-clip-edit.js";
import { clipEditInputs } from "../../apps/mcp-server/src/clip-edit-inputs.js";

const readback = { project: { id: "project" }, sequence: { id: "sequence", name: "WORKING__test" }, editBoundary: { allowed: true }, page: { hasMore: false, scanTruncated: false },
  items: [{ id: "video:0:0:source", projectItemId: "source", mediaType: "video", trackIndex: 0,
    start: { seconds: 0 }, end: { seconds: 10 }, inPoint: { seconds: 5 }, outPoint: { seconds: 15 } }] };
const operationId = "d23d1586-cd88-48d4-b160-b544d0e737d6";

describe("exact clip command preparation", () => {
  it.each([
    { kind: "split" as const, atSeconds: 5 }, { kind: "move" as const, offsetSeconds: 10 },
    { kind: "move_to_track" as const, destinationTrackIndex: 1 },
    { kind: "trim" as const, endSeconds: 8 }, { kind: "lift" as const },
  ])("reuses the real tool schema for $kind and preserves inspected guards", intent => {
    const prepared = prepareClipEdit(readback, intent, operationId);
    expect(z.object(clipEditInputs[prepared.tool]).parse(prepared.arguments)).toEqual(prepared.arguments);
    expect(prepared.arguments).toMatchObject({ expectedProjectId: "project", expectedSequenceId: "sequence", operationId });
    expect(JSON.stringify(prepared.arguments)).toContain('"expectedProjectItemId":"source"');
    expect(prepared.validation).toBe("arguments_only");
  });
  it("fails for a missing/ambiguous target, forbidden scope or unavailable source trim points", () => {
    for (const items of [[], [...readback.items, ...readback.items]]) {
      expect(() => prepareClipEdit({ ...readback, items }, { kind: "lift" }, operationId)).toThrow();
    }
    expect(() => prepareClipEdit({ ...readback, editBoundary: { allowed: false } }, { kind: "lift" }, operationId)).toThrow();
    expect(() => prepareClipEdit({ ...readback, page: { hasMore: true, scanTruncated: false } }, { kind: "lift" }, operationId)).toThrow();
    expect(() => prepareClipEdit({ ...readback, page: { hasMore: false, scanTruncated: true } }, { kind: "lift" }, operationId)).toThrow();
    expect(() => prepareClipEdit({ ...readback, items: [{ ...readback.items[0], inPoint: undefined }] }, { kind: "trim", endSeconds: 8 }, operationId)).toThrow();
  });
});
