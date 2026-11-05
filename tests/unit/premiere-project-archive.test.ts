import { describe, expect, it } from "vitest";
import { parsePremiereProjectTransitions, verifyTransitionArchiveMutation } from "../../apps/mcp-server/src/premiere-project-archive.js";

const TICKS = 254_016_000_000;
function xml(matchName: string | undefined, durationTicks = TICKS / 2): string {
  const transition = matchName ? `
  <VideoTransitionTrackItem ObjectID="t1"><TransitionTrackItem><TrackItem><Start>1000</Start><End>${1000 + durationTicks}</End></TrackItem><DisplayName>Cross Dissolve</DisplayName><MatchName>${matchName}</MatchName><HasOutgoingClip>false</HasOutgoingClip><HasIncomingClip>true</HasIncomingClip></TransitionTrackItem></VideoTransitionTrackItem>` : "";
  const reference = matchName ? '<HeadTransition ObjectRef="t1"/>' : "";
  return `<PremiereData>${transition}<VideoClipTrackItem ObjectID="c1"><ClipTrackItem><TrackItem><Start>1000</Start><End>999999</End></TrackItem>${reference}</ClipTrackItem></VideoClipTrackItem></PremiereData>`;
}

describe("Premiere project archive transition verification", () => {
  it("parses only transitions attached to timeline clips", () => {
    const snapshot = parsePremiereProjectTransitions(xml("AE.ADBE Cross Dissolve New"));
    expect(snapshot.attachments).toEqual([expect.objectContaining({
      clipObjectId: "c1",
      position: "start",
      matchName: "AE.ADBE Cross Dissolve New",
      hasIncomingClip: true,
      hasOutgoingClip: false,
    })]);
    expect(snapshot.attachments[0]?.durationSeconds).toBeCloseTo(0.5, 6);
  });

  it("passes an applied transition only when type, edge, duration, and sidedness are serialized", () => {
    const before = parsePremiereProjectTransitions(xml(undefined));
    const after = parsePremiereProjectTransitions(xml("AE.ADBE Cross Dissolve New"));
    const result = verifyTransitionArchiveMutation({
      command: "apply_transition",
      args: { trackItemId: "video:0:1000:source", matchName: "AE.ADBE Cross Dissolve New", position: "start", durationSeconds: 0.5, forceSingleSided: true },
      hostBefore: { items: [{ id: "video:0:1000:source", start: { ticks: "1000" }, end: { ticks: "999999" } }] },
      before,
      after,
    });
    expect(result).toMatchObject({ status: "pass", errors: [] });
  });

  it("fails when the serialized transition type does not match", () => {
    const result = verifyTransitionArchiveMutation({
      command: "apply_transition",
      args: { trackItemId: "video:0:1000:source", matchName: "ADBE Film Dissolve", position: "start", durationSeconds: 0.5, forceSingleSided: true },
      hostBefore: { items: [{ id: "video:0:1000:source", start: { ticks: "1000" } }] },
      before: parsePremiereProjectTransitions(xml(undefined)),
      after: parsePremiereProjectTransitions(xml("AE.ADBE Cross Dissolve New")),
    });
    expect(result.status).toBe("fail");
  });

  it("passes removal when an attached transition disappears", () => {
    const result = verifyTransitionArchiveMutation({
      command: "remove_transition",
      args: { trackItemId: "video:0:1000:source", position: "start" },
      hostBefore: { items: [{ id: "video:0:1000:source", start: { ticks: "1000" } }] },
      before: parsePremiereProjectTransitions(xml("AE.ADBE Cross Dissolve New")),
      after: parsePremiereProjectTransitions(xml(undefined)),
    });
    expect(result.status).toBe("pass");
  });
});
