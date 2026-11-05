import { describe, expect, it } from "vitest";
import { projectSnapshotSchema } from "../../packages/contracts/src/index";

describe("projectSnapshotSchema caption tracks", () => {
  it("preserves native caption track state and item counts", () => {
    const parsed = projectSnapshotSchema.parse({
      projectId: "project-1",
      projectName: "Heritage",
      projectPath: "C:\\project\\heritage.prproj",
      capturedAt: "2026-08-25T03:00:00.000Z",
      activeSequence: {
        id: "sequence-1",
        name: "HERITAGE_FINAL",
        videoTracks: 4,
        audioTracks: 3,
        captionTracks: 1,
        itemLimit: 500,
        itemsTruncated: false,
        items: [],
        tracks: [],
        captionTrackStates: [
          {
            index: 0,
            id: 1,
            name: "Subtitle",
            muted: false,
            itemCount: 11,
          },
        ],
        transitions: [],
      },
      sequences: [{ id: "sequence-1", name: "HERITAGE_FINAL" }],
      projectItems: [],
      projectItemLimit: 500,
      projectItemsTruncated: false,
      offlineMediaIds: [],
      proxyAttachments: [],
      markers: [],
      mogrtItems: [],
      effects: [],
      audioState: [],
      unsupportedFields: [],
    });

    expect(parsed.activeSequence?.captionTrackStates).toEqual([
      {
        index: 0,
        id: 1,
        name: "Subtitle",
        muted: false,
        itemCount: 11,
        transitionCount: 0,
      },
    ]);
  });

  it("defaults missing caption track state for older snapshots", () => {
    const parsed = projectSnapshotSchema.parse({
      projectId: "project-1",
      projectName: "Heritage",
      projectPath: "C:\\project\\heritage.prproj",
      capturedAt: "2026-08-25T03:00:00.000Z",
      activeSequence: {
        id: "sequence-1",
        name: "HERITAGE_FINAL",
        videoTracks: 4,
        audioTracks: 3,
        captionTracks: 0,
        itemLimit: 500,
        itemsTruncated: false,
        items: [],
      },
      sequences: [],
      projectItems: [],
      projectItemLimit: 500,
      projectItemsTruncated: false,
      offlineMediaIds: [],
      proxyAttachments: [],
      markers: [],
      mogrtItems: [],
      effects: [],
      audioState: [],
      unsupportedFields: [],
    });

    expect(parsed.activeSequence?.captionTrackStates).toEqual([]);
  });
});
