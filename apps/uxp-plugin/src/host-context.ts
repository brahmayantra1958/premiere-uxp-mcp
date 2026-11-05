import { HostCommandError } from "./bridge-client.js";
import { text, normalizeHostPath, type AnyRecord } from "./host-foundation.js";
import {exactTicksFromSeconds,exactTickOffsetFromSeconds} from './tick-conversion.js';
import { isLocalProjectPath } from '@premiere-uxp/contracts/local-path';
import { readOpenProjects } from './host-project-lifecycle.js';
declare const require: (name: string) => any;
export const ppro = require("premierepro") as any;
export const uxp = require("uxp") as any;

export function assertMethod(owner: any, name: string, apiLabel = name): void {
  if (typeof owner?.[name] !== "function") throw new HostCommandError("UNSUPPORTED_API", `Premiere ${text(uxp.host?.version) || "unknown"} does not expose ${apiLabel}`);
}

/** Every native time is built from exact ticks. TickTime.createWithSeconds floors
 * the binary product: 1.001 s became 254270015999 ticks, one short of frame 30,
 * which frame-tolerant readback accepted and exact consumers then rejected. */
function verifiedTickTime(ticks: string, message: string): any {
  assertMethod(ppro.TickTime, 'createWithTicks', 'TickTime.createWithTicks');
  const time = ppro.TickTime.createWithTicks(ticks);
  if (text(time?.ticks) !== ticks) throw new HostCommandError('TICK_TIME_UNVERIFIED', message);
  return time;
}

/** Signed tick string (`-?digits`) to a proven native time. A negative offset
 * uses the string factory when Premiere keeps it, otherwise TIME_ZERO - |offset|. */
export function tickTimeFromTicks(ticks: string): any {
  if (!/^-?\d+$/.test(ticks)) throw new HostCommandError('INVALID_TIME', `Invalid tick time: ${ticks}`);
  const message = `Premiere did not preserve the exact ${ticks}-tick time`;
  if (!ticks.startsWith('-')) return verifiedTickTime(ticks, message);
  assertMethod(ppro.TickTime, 'createWithTicks', 'TickTime.createWithTicks');
  let direct: any;
  try { direct = ppro.TickTime.createWithTicks(ticks); } catch { direct = undefined; }
  if (text(direct?.ticks) === ticks) return direct;
  const zero = ppro.TickTime.TIME_ZERO;
  assertMethod(zero, 'subtract', 'TickTime.subtract');
  const derived = zero.subtract(verifiedTickTime(ticks.slice(1), message));
  if (text(derived?.ticks) !== ticks) throw new HostCommandError('TICK_TIME_UNVERIFIED', message);
  return derived;
}

/** Absolute time: decimal seconds rounded to the nearest tick. */
export function tickFromSeconds(seconds: number): any {
  if (!Number.isFinite(seconds) || seconds < 0) throw new HostCommandError("INVALID_TIME", `Invalid non-negative time: ${seconds}`);
  return tickTimeFromTicks(exactTicksFromSeconds(seconds));
}

/** Relative time (move/clone offset): signed seconds rounded to the nearest tick. */
export function tickOffsetFromSeconds(seconds: number): any {
  if (!Number.isFinite(seconds)) throw new HostCommandError("INVALID_TIME", `Invalid time offset: ${seconds}`);
  return tickTimeFromTicks(exactTickOffsetFromSeconds(seconds));
}

/** Source boundaries must not slip below an exact frame through float ticks. */
export function exactTickFromSeconds(seconds:number):any {
  return verifiedTickTime(exactTicksFromSeconds(seconds), 'Premiere did not preserve the exact source-boundary ticks');
}

export async function activeProject(): Promise<any> {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new HostCommandError("NO_ACTIVE_PROJECT", "Premiere has no active project");
  return project;
}

export async function activeSequence(project?: any): Promise<any> {
  const owner = project ?? await activeProject();
  const sequence = await owner.getActiveSequence();
  if (!sequence) throw new HostCommandError("NO_ACTIVE_SEQUENCE", "Premiere has no active sequence");
  return sequence;
}

export async function inspectHostContext(options: { includeOpenProjects?: boolean } = {}): Promise<AnyRecord> {
  const openProjects = options.includeOpenProjects === true ? await readOpenProjects(ppro) : undefined;
  let project: any;
  try { project = await ppro.Project.getActiveProject(); } catch (error) { if (options.includeOpenProjects === true) throw error; project = undefined; }
  if (!project) return { activeProject: false, activeSequence: false, ...(openProjects ? { openProjects } : {}) };
  let sequence: any;
  try { sequence = await project.getActiveSequence(); } catch (error) { if (options.includeOpenProjects === true) throw error; sequence = undefined; }
  return {
    activeProject: true,
    activeSequence: Boolean(sequence),
    projectId: text(project.guid),
    projectName: text(project.name),
    projectPath: text(project.path),
    ...(openProjects ? { openProjects } : {}),
    ...(sequence ? { sequenceId: await sequenceId(sequence), sequenceName: text(sequence.name) } : {}),
  };
}

export function assertWorkingProject(project: any): void {
  const normalized=normalizeHostPath(text(project.path));
  if(!isLocalProjectPath(normalized))
    throw new HostCommandError('LOCAL_PROJECT_REQUIRED','Save the active project to a local .prproj before editing; NAS source storage remains read-only');
}

export function assertWorkingSequence(sequence: any): void {
  if(!text(sequence.guid)||!text(sequence.name))throw new HostCommandError('NO_ACTIVE_SEQUENCE','An existing sequence with a stable identity is required');
}

export async function mutationContext(pins?:AnyRecord): Promise<{ project: any; sequence: any }> {
  const project = await activeProject();
  assertWorkingProject(project);
  if(pins?.expectedProjectId!==undefined&&text(project.guid)!==pins.expectedProjectId)throw new HostCommandError('PROJECT_PRECONDITION_FAILED','Current project differs from requested target');
  let sequence = await activeSequence(project);
  // Navigation may change between transactions. Resolve the command's exact ID
  // again without activating it; never substitute the newly visible sequence.
  if(pins?.expectedSequenceId!==undefined&&await sequenceId(sequence)!==pins.expectedSequenceId){
    const matches=[];
    for(const candidate of await project.getSequences())if(await sequenceId(candidate)===pins.expectedSequenceId)matches.push(candidate);
    if(matches.length!==1)throw new HostCommandError('SEQUENCE_PRECONDITION_FAILED','The pinned sequence is no longer uniquely available');
    sequence=matches[0];
  }
  assertWorkingSequence(sequence);
  if(pins?.expectedSequenceName!==undefined&&text(sequence.name)!==pins.expectedSequenceName)throw new HostCommandError('SEQUENCE_PRECONDITION_FAILED','The pinned sequence name changed');
  return { project, sequence };
}

export async function itemId(item: any): Promise<string> {
  return text(await item.getId?.()) || text(item.guid) || text(item.name);
}

export async function sequenceId(sequence: any): Promise<string> {
  return text(sequence.guid) || text(await sequence.getId?.()) || text(sequence.name);
}
