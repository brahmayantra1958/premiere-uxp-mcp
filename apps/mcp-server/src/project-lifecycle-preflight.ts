import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';
import { z } from 'zod/v4';

const projectViewSchema = z.object({
  guid: z.string().min(1), path: z.string().min(1), name: z.string(), viewIds: z.array(z.string().min(1)).min(1),
});
export const openProjectViewsSchema = z.object({
  status: z.literal('pass'), scope: z.literal('project_views'), projects: z.array(projectViewSchema), viewCount: z.number().int().nonnegative(),
});
const lifecycleContextSchema = z.object({
  activeProject: z.boolean(), activeSequence: z.boolean(), projectId: z.string().optional(), projectPath: z.string().optional(),
  sequenceId: z.string().optional(), sequenceName: z.string().optional(), openProjects: openProjectViewsSchema,
});
export type LifecycleTarget = { projectId: string; projectPath: string; sequenceId: string; sequenceName: string };
export type LifecycleContext = z.infer<typeof lifecycleContextSchema>;
type HostRead = { read(command: string, args?: Record<string, unknown>): Promise<unknown> };

/** Project GUIDs survive copied files. Path is part of the identity, and view
 * enumeration is evidence of observed views, not a complete all-open guarantee. */
export function validateProjectViews(value: unknown) {
  const views = openProjectViewsSchema.parse(value);
  const ids = views.projects.flatMap(project => project.viewIds);
  if (ids.length !== views.viewCount || new Set(ids).size !== ids.length) throw Error('PROJECT_VIEWS_INCOMPLETE: inconsistent view count or duplicate view ID');
  return views;
}

export async function readLifecycleContext(host: HostRead): Promise<LifecycleContext> {
  const context = lifecycleContextSchema.parse(await host.read('inspect_host_context', { includeOpenProjects: true }));
  validateProjectViews(context.openProjects);
  return context;
}

export function assertExclusiveLifecycleTarget(context: LifecycleContext, target: LifecycleTarget): void {
  const views = validateProjectViews(context.openProjects);
  const expectedPath = normalizeLocalPath(target.projectPath);
  if (!target.projectId || !expectedPath || !context.activeProject || !context.activeSequence
    || context.projectId !== target.projectId || normalizeLocalPath(context.projectPath ?? '') !== expectedPath
    || context.sequenceId !== target.sequenceId || context.sequenceName !== target.sequenceName) {
    throw Error('PROJECT_LIFECYCLE_TARGET_CHANGED: active project path/GUID or sequence differs from the requested lifecycle target');
  }
  const duplicateGuid = views.projects.filter(project => project.guid === target.projectId && normalizeLocalPath(project.path) !== expectedPath);
  if (duplicateGuid.length) throw Error('DUPLICATE_OPEN_PROJECT_GUID: ' + JSON.stringify(duplicateGuid));
  const otherProjects = views.projects.filter(project => project.guid !== target.projectId || normalizeLocalPath(project.path) !== expectedPath);
  if (otherProjects.length) throw Error('PROJECT_LIFECYCLE_MULTIPLE_PROJECTS: ' + JSON.stringify(otherProjects));
  if (!views.projects.length) throw Error('PROJECT_LIFECYCLE_PREFLIGHT_UNVERIFIED: active target is missing from observed project views');
}

export async function lifecyclePreflight(host: HostRead, target: LifecycleTarget) {
  let context: LifecycleContext | undefined;
  try {
    context = await readLifecycleContext(host);
    assertExclusiveLifecycleTarget(context, target);
    return undefined;
  } catch (error) {
    return {
      status: 'fail' as const, changedFiles: [] as string[], errors: ['PROJECT_LIFECYCLE_PREFLIGHT_FAILED: ' + String(error)],
      result: { phase: 'preflight', contentDispatched: false, retryable: false, target, ...(context ? { observation: context } : {}) },
    };
  }
}

/** A fresh strict read guards against reopening between the native close
 * witness and archive replacement. It never substitutes for that witness. */
export function assertLifecycleStillClosed(context: LifecycleContext): void {
  const views = validateProjectViews(context.openProjects);
  if (context.activeProject || context.activeSequence || views.projects.length) throw Error('PROJECT_LIFECYCLE_PROJECT_REOPENED: active project or observed project views remain');
}

/** Neither a close boolean nor a failed/empty active-project read proves close.
 * The host must supply its exact native CLOSED event and strict view readback. */
export function verifiedProjectClose(receipt: unknown, target: LifecycleTarget) {
  const closed = z.object({ status: z.literal('pass'), hostResult: z.object({
    saved: z.literal(true), closed: z.literal(true), closeDispatched: z.literal(true),
    closeVerification: z.object({
      status: z.literal('pass'), projectId: z.string(), projectPath: z.string(),
      closedEvent: z.object({ id: z.string(), path: z.string(), name: z.string() }), openProjects: openProjectViewsSchema,
    }),
  }) }).parse(receipt).hostResult.closeVerification;
  const expectedPath = normalizeLocalPath(target.projectPath);
  if (closed.projectId !== target.projectId || normalizeLocalPath(closed.projectPath) !== expectedPath
    || closed.closedEvent.id !== target.projectId || normalizeLocalPath(closed.closedEvent.path) !== expectedPath) {
    throw Error('PROJECT_CLOSE_TARGET_MISMATCH: native event or close proof belongs to another project path/GUID');
  }
  const views = validateProjectViews(closed.openProjects);
  if (views.projects.some(project => normalizeLocalPath(project.path) === expectedPath)) throw Error('PROJECT_CLOSE_NOT_OBSERVED: target path remains in project views');
  // This archive workflow requires exclusive views; generic close can prove a
  // target absent while another GUID-identical path remains open.
  if (views.projects.length) throw Error('PROJECT_LIFECYCLE_MULTIPLE_PROJECTS: another project appeared after close');
  return closed;
}
