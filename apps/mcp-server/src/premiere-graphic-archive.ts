import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { inspectPremiereRectangleProjectXml, type EditableRectangleMogrtSpec } from "./editable-rectangle-mogrt.js";

type Target = { sequenceId: string; trackIndex: number; startTicks: string; endTicks: string };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function object(xml: string, id: string, uid = false): string {
  const matches = [...xml.matchAll(new RegExp(`<([A-Za-z0-9_]+)\\b[^>]*Object${uid ? "UID" : "ID"}="${escape(id)}"[^>]*>[\\s\\S]*?<\\/\\1>`, "g"))];
  if (matches.length !== 1) throw Error(`GRAPHIC_ARCHIVE_OBJECT_NOT_UNIQUE: ${id}`);
  return matches[0]![0];
}
function ref(block: string, tag: string): string {
  const id = new RegExp(`<${tag}\\b[^>]*ObjectRef="(\\d+)"`).exec(block)?.[1];
  if (!id) throw Error(`GRAPHIC_ARCHIVE_REFERENCE_MISSING: ${tag}`);
  return id;
}
const tick = (block: string, tag: string) => new RegExp(`<${tag}>(-?\\d+)</${tag}>`).exec(block)?.[1] ?? "0";

/** Follow only sequence -> video group -> requested track -> exact bounds ->
 * clip component chain. A matching Shape elsewhere in the project is no proof. */
export function inspectSavedRectangle(xml: string, target: Target) {
  const sequence = object(xml, target.sequenceId, true);
  if (!sequence.startsWith("<Sequence ")) throw Error("GRAPHIC_ARCHIVE_SEQUENCE_TYPE");
  const groups = [...sequence.matchAll(/<Second ObjectRef="(\d+)"\/>/g)].map(m => object(xml, m[1]!));
  const videos = groups.filter(g => g.startsWith("<VideoTrackGroup "));
  if (videos.length !== 1) throw Error("GRAPHIC_ARCHIVE_VIDEO_GROUP_NOT_UNIQUE");
  const trackId = new RegExp(`<Track Index="${target.trackIndex}" ObjectURef="([^"]+)"`).exec(videos[0]!)?.[1];
  if (!trackId) throw Error("GRAPHIC_ARCHIVE_TRACK_MISSING");
  const track = object(xml, trackId, true);
  const clips = [...track.matchAll(/<TrackItem Index="\d+" ObjectRef="(\d+)"\/>/g)]
    .map(m => object(xml, m[1]!)).filter(b => b.startsWith("<VideoClipTrackItem ") && tick(b, "Start") === target.startTicks && tick(b, "End") === target.endTicks);
  if (clips.length !== 1) throw Error("GRAPHIC_ARCHIVE_CLIP_NOT_UNIQUE");
  const chain = object(xml, ref(clips[0]!, "Components"));
  const components = [...chain.matchAll(/<Component Index="\d+" ObjectRef="(\d+)"\/>/g)].map(m => object(xml, m[1]!));
  const shapes = components.filter(b => /<MatchName>AE\.ADBE (Shape|Text)<\/MatchName>/.test(b));
  const parameters = shapes.flatMap(b => [...b.matchAll(/<Param Index="\d+" ObjectRef="(\d+)"\/>/g)].map(m => object(xml, m[1]!)));
  return inspectPremiereRectangleProjectXml([...shapes, ...parameters].join("\n"), true);
}

export async function verifySavedRectangle(projectPath: string, target: Target, expected: EditableRectangleMogrtSpec) {
  const bytes = await readFile(projectPath);
  const actual = inspectSavedRectangle((bytes[0] === 0x1f ? gunzipSync(bytes) : bytes).toString("utf8"), target);
  const errors: string[] = [];
  for (const key of ["widthPixels", "heightPixels", "strokeWidthPixels", "opacityPercent", "rotationDegrees"] as const)
    if (Math.abs(actual[key] - expected[key]) > 0.0001) errors.push(`Saved shape ${key} differs`);
  for (const key of ["fillColorHex", "strokeColorHex"] as const)
    if (actual[key].toUpperCase() !== expected[key].toUpperCase()) errors.push(`Saved shape ${key} differs`);
  if (Math.abs(actual.position.x - expected.position.x) > 0.0001 || Math.abs(actual.position.y - expected.position.y) > 0.0001) errors.push("Saved shape position differs");
  if (!actual.hiddenText) errors.push("Template helper text is not hidden");
  return { status: errors.length ? "fail" as const : "pass" as const, actual, target, errors };
}
