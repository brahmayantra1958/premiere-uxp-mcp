import { assessRelocation, planTrackRelocation, stableValue, type RelocationItem, type RelocationRequest, type RelocationState } from "./track-relocation.js";
import type { HostResult } from "./wire.js";

export type SequenceClip = Omit<RelocationRequest, "destinationTrackIndex"> & { ref: string };
export type TrackCommandSequence = {
  protocolVersion: 1;
  expectedProjectId: string; expectedSequenceId: string; expectedSequenceName: string;
  clips: SequenceClip[];
  steps: { clipRef: string; destinationTrackIndex: number }[];
  minIntervalMs: number; maxRunMs: number;
};
export type SequenceStepResult = {
  index: number; clipRef: string; destinationTrackIndex: number; startedMs: number; durationMs: number;
  status: HostResult["status"]; hostResult?: unknown; workTarget?: HostResult["workTarget"]; errors?: string[] | undefined;
};

/** Host validation is independent of the MCP client's schema. No script/command strings. */
export function parseTrackCommandSequence(value: any): TrackCommandSequence {
  const integer = (v: unknown, min: number, max: number) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
  if (!value || value.protocolVersion !== 1 || ["expectedProjectId", "expectedSequenceId", "expectedSequenceName"].some(k => typeof value[k] !== "string" || !value[k])) throw Error("Exact sequence identity and protocolVersion 1 are required");
  if (!Array.isArray(value.clips) || !integer(value.clips.length, 1, 64) || !Array.isArray(value.steps) || !integer(value.steps.length, 1, 256)) throw Error("Sequence requires 1–64 clips and 1–256 steps");
  if (!integer(value.minIntervalMs, 0, 5000) || !integer(value.maxRunMs, 1000, 900000)) throw Error("Invalid interval or run deadline");
  const refs = new Set<string>(); const ids = new Set<string>();
  for (const clip of value.clips) {
    if (!clip || typeof clip.ref !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(clip.ref) || refs.has(clip.ref) ||
      typeof clip.trackItemId !== "string" || !clip.trackItemId || ids.has(clip.trackItemId) || typeof clip.expectedProjectItemId !== "string" || !clip.expectedProjectItemId ||
      !["video", "audio"].includes(clip.expectedMediaType) || !integer(clip.expectedTrackIndex, 0, 99) ||
      ["expectedStartSeconds", "expectedEndSeconds", "expectedInPointSeconds", "expectedOutPointSeconds"].some(k => !Number.isFinite(clip[k]) || clip[k] < 0)) throw Error("Invalid, duplicate or unguarded clip reference");
    refs.add(clip.ref); ids.add(clip.trackItemId);
  }
  for (const step of value.steps) if (!step || !refs.has(step.clipRef) || !integer(step.destinationTrackIndex, 0, 99)) throw Error("Invalid step reference or destination");
  // Freeze by value: request mutation must never alter an already accepted job.
  return JSON.parse(JSON.stringify(value)) as TrackCommandSequence;
}

export function moveForItem(item: RelocationItem, destinationTrackIndex: number): RelocationRequest {
  return { trackItemId: item.id, expectedProjectItemId: item.projectItemId, expectedMediaType: item.mediaType as "video" | "audio",
    expectedTrackIndex: item.trackIndex, expectedStartSeconds: item.start.seconds, expectedEndSeconds: item.end.seconds,
    expectedInPointSeconds: item.inPoint.seconds, expectedOutPointSeconds: item.outPoint.seconds, destinationTrackIndex };
}

export function stateErrors(expected: RelocationState, observed: RelocationState): string[] {
  const item = expected.sequence.items[0] as RelocationItem;
  return assessRelocation(expected, observed, { source: item, destination: item }, "restored");
}

/** Validate the complete dependency chain before the first edit, including occupancy. */
export function preflightTrackCommandSequence(plan: TrackCommandSequence, baseline: RelocationState) {
  const simulated = JSON.parse(JSON.stringify(baseline)) as RelocationState;
  const bindings = new Map<string, RelocationItem>();
  for (const clip of plan.clips) {
    const firstStep = plan.steps.find(step => step.clipRef === clip.ref);
    if (!firstStep) throw Error(`Unused clip reference: ${clip.ref}`);
    bindings.set(clip.ref, planTrackRelocation({ ...clip, destinationTrackIndex: firstStep.destinationTrackIndex }, baseline).source);
  }
  for (const step of plan.steps) {
    const move = planTrackRelocation(moveForItem(bindings.get(step.clipRef)!, step.destinationTrackIndex), simulated);
    simulated.sequence.items = simulated.sequence.items.map((item: RelocationItem) => item.id === move.source.id ? move.destination : item);
    simulated.effects[move.destination.id] = simulated.effects[move.source.id]; delete simulated.effects[move.source.id];
    bindings.set(step.clipRef, move.destination);
  }
  return { expectedFinal: simulated, returnsToStart: stateErrors(baseline, simulated).length === 0 };
}

export type SequenceAdapter = {
  read(plan: TrackCommandSequence): Promise<RelocationState>;
  move(plan: TrackCommandSequence, move: RelocationRequest, id: string, expected: RelocationState,
    verified: (state: RelocationState) => void): Promise<HostResult>;
};
type Job = {
  id: string; fingerprint: string; plan: TrackCommandSequence;
  state: "queued" | "running" | "pass" | "fail" | "unverified" | "cancelled";
  acceptedAt: string; completedAt?: string; started?: number; elapsedMs: number; cancelRequested: boolean;
  results: SequenceStepResult[]; completedSteps: number; currentStep?: number; error?: string;
  preservation?: { expectedState: "pass" | "unverified"; returnedToStart: boolean; errors: string[] };
  preflightMs?: number; finalReadMs?: number;
};

/** One job owns the host command queue. Status/cancellation only read this memory;
 * they never navigate the timeline, scan media, or interrupt a native transaction.
 * A panel reload loses job memory: UNKNOWN is UNVERIFIED, never permission to replay. */
export class TrackCommandSequences {
  private readonly jobs = new Map<string, Job>();
  private activeId: string | undefined;
  get busy(): boolean { return this.activeId !== undefined; }
  get activeJobId(): string | undefined { return this.activeId; }
  constructor(private readonly progress:(event:{jobId:string;state:string;completedSteps:number;totalSteps:number;durationMs:number})=>void=()=>{}){}
  private emit(job:Job){try{this.progress({jobId:job.id,state:job.state,completedSteps:job.completedSteps,totalSteps:job.plan.steps.length,durationMs:job.started?performance.now()-job.started:0});}catch{/* Observation never changes native execution/proof. */}}

  accept(id: string, args: unknown): { job: Job; fresh: boolean } {
    const plan = parseTrackCommandSequence(args);
    const fingerprint = stableValue(plan);
    const prior = this.jobs.get(id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Error("Sequence ID reused with different commands");
      return { job: prior, fresh: false };
    }
    if (this.busy) throw Error("COMMAND_SEQUENCE_BUSY: inspect or cancel the active job first");
    const job: Job = { id, fingerprint, plan, state: "queued", acceptedAt: new Date().toISOString(), elapsedMs: 0, cancelRequested: false, results: [], completedSteps: 0 };
    this.jobs.set(id, job); this.activeId = id;
    // Receipt persistence belongs to MCP; keep a bounded host status history.
    while (this.jobs.size > 8) this.jobs.delete(this.jobs.keys().next().value!);
    this.emit(job);return { job, fresh: true };
  }

  status(id: string, cursor = 0) {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 256) throw Error("Invalid result cursor");
    const job = this.jobs.get(id);
    if (!job) return { protocolVersion: 1, jobId: id, state: "unverified", error: "Job unknown in this panel session; inspect timeline before retry. Reloaded jobs never resume automatically." };
    const end = Math.min(job.results.length, cursor + 50);
    return { protocolVersion: 1, jobId: id, state: job.state, acceptedAt: job.acceptedAt, completedAt: job.completedAt, completedSteps: job.completedSteps,
      totalSteps: job.plan.steps.length, currentStep: job.currentStep, cancelRequested: job.cancelRequested,
      currentCommand: job.currentStep === undefined ? undefined : job.plan.steps[job.currentStep],
      elapsedMs: job.state === "running" ? performance.now() - job.started! : job.elapsedMs,
      results: job.results.slice(cursor, end), nextCursor: end, hasMore: end < job.results.length,
      error: job.error, preservation: job.preservation, preflightMs: job.preflightMs, finalReadMs: job.finalReadMs };
  }

  cancel(id: string) {
    const job = this.jobs.get(id);
    if (job && ["queued", "running"].includes(job.state)) job.cancelRequested = true;
    return this.status(id);
  }

  rejectedBeforeRun(id: string, error: unknown): void {
    const job = this.jobs.get(id);
    if (job?.state === "queued") { job.state = "fail"; job.error = String(error); this.activeId = undefined;this.emit(job); }
  }

  async run(id: string, adapter: SequenceAdapter): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || job.state !== "queued" || this.activeId !== id) throw Error("Only the accepted queued job can run; completed jobs cannot replay");
    job.state = "running"; job.started = performance.now();this.emit(job);
    let expected: RelocationState | undefined; let baseline: RelocationState | undefined;
    let expectedFinal: RelocationState | undefined;
    try {
      const start = performance.now();
      baseline = await adapter.read(job.plan);
      expectedFinal = preflightTrackCommandSequence(job.plan, baseline).expectedFinal;
      job.preflightMs = performance.now() - start; expected = baseline;
      const bindings = new Map(job.plan.clips.map(clip => [clip.ref, baseline!.sequence.items.find((item: RelocationItem) => item.id === clip.trackItemId) as RelocationItem]));
      let previousStart = -Infinity;
      let stopState: "cancelled" | "fail" | "unverified" | undefined;
      for (const [index, step] of job.plan.steps.entries()) {
        // Minimum START spacing. Slow host work stretches the interval; never
        // dispatch concurrently or burst to catch up with a missed schedule.
        while (!job.cancelRequested && performance.now() - previousStart < job.plan.minIntervalMs && performance.now() - job.started < job.plan.maxRunMs) {
          await new Promise(resolve => setTimeout(resolve, Math.min(50, job.plan.minIntervalMs - (performance.now() - previousStart))));
        }
        if (job.cancelRequested) { stopState = "cancelled"; break; }
        if (performance.now() - job.started >= job.plan.maxRunMs) { stopState = "fail"; job.error = "Run deadline reached between steps; remaining commands were not dispatched"; break; }
        job.currentStep = index;
        const source = bindings.get(step.clipRef)!;
        previousStart = performance.now();
        let proven: RelocationState | undefined;
        const result = await adapter.move(job.plan, moveForItem(source, step.destinationTrackIndex), `${id}:step:${index}`, expected!, state => { proven = state; });
        job.results.push({ index, ...step, startedMs: previousStart - job.started, durationMs: performance.now() - previousStart,
          status: result.status, hostResult: result.hostResult, workTarget: result.workTarget, errors: result.errors });
        if (result.status !== "pass" || !proven) {
          // Even a locally restored failing step leaves earlier steps in place.
          stopState = result.status === "fail" ? "fail" : "unverified";
          job.error = result.errors?.join("; ") || "Step did not provide verified content; stopped without retry";
          break;
        }
        expected = proven;
        const destination = expected.sequence.items.find((item: RelocationItem) => item.id === (result.hostResult as any)?.plan?.destination?.id);
        if (!destination) throw Error("Verified step omitted the fresh destination identity");
        bindings.set(step.clipRef, destination); job.completedSteps++;this.emit(job);
      }
      delete job.currentStep;
      const finalStart = performance.now();
      const final = await adapter.read(job.plan); job.finalReadMs = performance.now() - finalStart;
      const errors = stateErrors(job.completedSteps === job.plan.steps.length ? expectedFinal : expected!, final);
      job.preservation = { expectedState: errors.length ? "unverified" : "pass", returnedToStart: stateErrors(baseline, final).length === 0, errors };
      if (errors.length) { job.state = "unverified"; job.error = errors.join("; "); }
      else if (job.completedSteps === job.plan.steps.length) job.state = "pass";
      else job.state = stopState ?? "unverified";
    } catch (error) {
      job.error = String(error);
      job.state = job.currentStep === undefined && job.completedSteps === 0 ? "fail" : "unverified";
    } finally {
      job.elapsedMs = performance.now() - job.started;
      job.completedAt = new Date().toISOString();
      this.activeId = undefined;
      this.emit(job);
    }
  }
}
