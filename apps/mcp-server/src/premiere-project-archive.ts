import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const unzip = promisify(gunzip);
const TICKS_PER_SECOND = 254_016_000_000;
const MAX_FRAME_ERROR_SECONDS = 1 / 23;

export type TransitionArchiveAttachment = {
  clipObjectId: string;
  position: "start" | "end";
  clipStartTicks: string;
  clipEndTicks: string;
  transitionObjectId: string;
  matchName: string;
  displayName: string;
  startTicks: string;
  endTicks: string;
  durationSeconds: number;
  hasIncomingClip: boolean;
  hasOutgoingClip: boolean;
};

export type TransitionArchiveSnapshot = {
  projectPath: string;
  attachmentCount: number;
  attachments: TransitionArchiveAttachment[];
};

type VerificationInput = {
  command: "apply_transition" | "remove_transition";
  args: Record<string, unknown>;
  hostBefore?: unknown;
  before: TransitionArchiveSnapshot;
  after: TransitionArchiveSnapshot;
};

function attribute(attributes: string, name: string): string {
  return new RegExp(String.raw`\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? "";
}

function tag(block: string, name: string): string {
  return new RegExp(String.raw`<${name}>([\s\S]*?)<\/${name}>`).exec(block)?.[1]?.trim() ?? "";
}

function tickValue(value: string): string {
  return /^-?\d+$/.test(value) ? value : "0";
}

function durationSeconds(startTicks: string, endTicks: string): number {
  return Number(BigInt(endTicks) - BigInt(startTicks)) / TICKS_PER_SECOND;
}

export function parsePremiereProjectTransitions(xml: string, projectPath = ""): TransitionArchiveSnapshot {
  const transitions = new Map<string, Omit<TransitionArchiveAttachment, "clipObjectId" | "position" | "clipStartTicks" | "clipEndTicks">>();
  const transitionPattern = /<VideoTransitionTrackItem\b([^>]*)>([\s\S]*?)<\/VideoTransitionTrackItem>/g;
  for (const match of xml.matchAll(transitionPattern)) {
    const objectId = attribute(match[1] ?? "", "ObjectID");
    if (!objectId) continue;
    const block = match[2] ?? "";
    const startTicks = tickValue(tag(block, "Start"));
    const endTicks = tickValue(tag(block, "End"));
    transitions.set(objectId, {
      transitionObjectId: objectId,
      matchName: tag(block, "MatchName"),
      displayName: tag(block, "DisplayName"),
      startTicks,
      endTicks,
      durationSeconds: durationSeconds(startTicks, endTicks),
      hasIncomingClip: tag(block, "HasIncomingClip") === "true",
      hasOutgoingClip: tag(block, "HasOutgoingClip") === "true",
    });
  }

  const attachments: TransitionArchiveAttachment[] = [];
  const clipPattern = /<VideoClipTrackItem\b([^>]*)>([\s\S]*?)<\/VideoClipTrackItem>/g;
  for (const match of xml.matchAll(clipPattern)) {
    const clipObjectId = attribute(match[1] ?? "", "ObjectID");
    const block = match[2] ?? "";
    const clipStartTicks = tickValue(tag(block, "Start"));
    const clipEndTicks = tickValue(tag(block, "End"));
    for (const [position, referenceTag] of [["start", "HeadTransition"], ["end", "TailTransition"]] as const) {
      const reference = new RegExp(String.raw`<${referenceTag}\b[^>]*ObjectRef="([^"]+)"[^>]*/>`).exec(block)?.[1];
      const transition = reference ? transitions.get(reference) : undefined;
      if (!clipObjectId || !transition) continue;
      attachments.push({ clipObjectId, position, clipStartTicks, clipEndTicks, ...transition });
    }
  }
  return { projectPath, attachmentCount: attachments.length, attachments };
}

export async function snapshotPremiereProjectTransitions(projectPath: string): Promise<TransitionArchiveSnapshot> {
  const compressed = await readFile(projectPath);
  const xmlBytes = compressed[0] === 0x1f && compressed[1] === 0x8b ? await unzip(compressed) : compressed;
  return parsePremiereProjectTransitions(xmlBytes.toString("utf8"), projectPath);
}

function attachmentSignature(item: TransitionArchiveAttachment): string {
  return [
    item.clipObjectId, item.position, item.transitionObjectId, item.matchName,
    item.startTicks, item.endTicks, item.hasIncomingClip, item.hasOutgoingClip,
  ].join("|");
}

function subtract(left: TransitionArchiveAttachment[], right: TransitionArchiveAttachment[]): TransitionArchiveAttachment[] {
  const counts = new Map<string, number>();
  for (const item of right) {
    const key = attachmentSignature(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return left.filter((item) => {
    const key = attachmentSignature(item);
    const remaining = counts.get(key) ?? 0;
    if (remaining <= 0) return true;
    counts.set(key, remaining - 1);
    return false;
  });
}

function targetEdgeTicks(args: Record<string, unknown>, hostBefore: unknown): string | undefined {
  const position = args.position === "end" ? "end" : "start";
  const items = (hostBefore as { items?: Array<{ id?: string; start?: { ticks?: string }; end?: { ticks?: string } }> } | undefined)?.items ?? [];
  const item = items.find((candidate) => candidate.id === args.trackItemId);
  const fromSnapshot = position === "end" ? item?.end?.ticks : item?.start?.ticks;
  if (fromSnapshot) return String(fromSnapshot);
  if (position === "start" && typeof args.trackItemId === "string") return args.trackItemId.split(":")[2];
  return undefined;
}

function atTargetEdge(item: TransitionArchiveAttachment, position: "start" | "end", edgeTicks: string | undefined): boolean {
  if (item.position !== position) return false;
  if (!edgeTicks) return true;
  return position === "start" ? item.clipStartTicks === edgeTicks : item.clipEndTicks === edgeTicks;
}

function durationMatches(item: TransitionArchiveAttachment, requested: unknown): boolean {
  if (requested == null) return true;
  const expected = Number(requested);
  return Number.isFinite(expected) && Math.abs(item.durationSeconds - expected) <= MAX_FRAME_ERROR_SECONDS;
}

function singleSidedMatches(item: TransitionArchiveAttachment, position: "start" | "end", requested: unknown): boolean {
  if (requested !== true) return true;
  return position === "start"
    ? item.hasIncomingClip && !item.hasOutgoingClip
    : item.hasOutgoingClip && !item.hasIncomingClip;
}

export function verifyTransitionArchiveMutation(input: VerificationInput): {
  status: "pass" | "fail";
  report: Record<string, unknown>;
  errors: string[];
} {
  const position = input.args.position === "end" ? "end" : "start";
  const edgeTicks = targetEdgeTicks(input.args, input.hostBefore);
  const beforeTarget = input.before.attachments.filter((item) => atTargetEdge(item, position, edgeTicks));
  const afterTarget = input.after.attachments.filter((item) => atTargetEdge(item, position, edgeTicks));
  const added = subtract(afterTarget, beforeTarget);
  const removed = subtract(beforeTarget, afterTarget);

  if (input.command === "remove_transition") {
    const pass = beforeTarget.length === 0 || removed.length > 0;
    return {
      status: pass ? "pass" : "fail",
      report: { position, edgeTicks, beforeTarget, afterTarget, removed, alreadyAbsent: beforeTarget.length === 0 },
      errors: pass ? [] : ["Saved Premiere project still contains the targeted transition attachment"],
    };
  }

  const requestedMatchName = String(input.args.matchName ?? "");
  const desiredAfter = afterTarget.filter((item) =>
    item.matchName === requestedMatchName
    && durationMatches(item, input.args.durationSeconds)
    && singleSidedMatches(item, position, input.args.forceSingleSided));
  const desiredAdded = added.filter((item) => desiredAfter.some((candidate) => attachmentSignature(candidate) === attachmentSignature(item)));
  const alreadySatisfied = desiredAfter.some((item) => beforeTarget.some((prior) => attachmentSignature(prior) === attachmentSignature(item)));
  const pass = desiredAdded.length > 0 || alreadySatisfied;
  return {
    status: pass ? "pass" : "fail",
    report: { position, edgeTicks, requestedMatchName, beforeTarget, afterTarget, added, removed, desiredAdded, alreadySatisfied },
    errors: pass ? [] : ["Saved Premiere project did not contain the requested attached transition with the requested duration and sidedness"],
  };
}
