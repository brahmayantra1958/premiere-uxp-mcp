import { HostCommandError } from './bridge-client.js';
import { normalizeHostPath, text } from './host-foundation.js';

export type ProjectIdentity = { guid: string; path: string; name: string };
export type OpenProjects = {
  status: 'pass'; scope: 'project_views'; viewCount: number;
  projects: (ProjectIdentity & { viewIds: string[] })[];
};
export type CloseVerification = {
  status: 'pass' | 'unverified'; projectId: string; projectPath: string;
  closedEvent: { id: string; path: string; name: string } | null;
  openProjects?: OpenProjects; reason?: string;
};
const samePath = (left: string, right: string) => normalizeHostPath(left) === normalizeHostPath(right);
const preflight = (code: string, message: string) => new HostCommandError(code, message,
  { contentDispatched: false, retryable: false, errorClassification: 'preflight' });

/** Project views are the public inventory, not an undocumented all-projects API.
 * Detach every GUID and project identity before the next native await. Two
 * complete mappings must agree: a stable view ID can be rebound to a different
 * project, so matching ID lists alone cannot establish target absence. */
export async function readOpenProjects(api: any): Promise<OpenProjects> {
  if (typeof api.ProjectUtils?.getProjectViewIds !== 'function' || typeof api.ProjectUtils?.getProjectFromViewId !== 'function')
    throw preflight('UNSUPPORTED_API', 'Strict project-view inventory requires ProjectUtils');
  const ids = async () => {
    const values = await api.ProjectUtils.getProjectViewIds();
    if (!Array.isArray(values)) throw Error('PROJECT_VIEW_INVENTORY_INVALID');
    const detached = values.map(value => text(value));
    if (detached.some(value => !value) || new Set(detached).size !== detached.length) throw Error('PROJECT_VIEW_INVENTORY_INVALID');
    return detached.sort();
  };
  const collect = async (): Promise<OpenProjects> => {
    const before = await ids();
    const projects: OpenProjects['projects'] = [];
    for (const viewId of before) {
      if (typeof api.Guid?.fromString !== 'function') throw preflight('UNSUPPORTED_API', 'Project-view lookup requires Guid.fromString');
      const project = await api.ProjectUtils.getProjectFromViewId(api.Guid.fromString(viewId));
      if (!project) throw Error('PROJECT_VIEW_PROJECT_UNAVAILABLE');
      const identity = { guid: text(project.guid), path: text(project.path), name: text(project.name) };
      if (!identity.guid) throw Error('PROJECT_VIEW_IDENTITY_INCOMPLETE');
      // Saved copies may share a GUID. Their paths remain distinct identities.
      const prior = projects.find(value => value.guid === identity.guid && samePath(value.path, identity.path));
      if (prior) {
        if (prior.name !== identity.name) throw Error('PROJECT_VIEW_IDENTITY_CHANGED');
        prior.viewIds.push(viewId);
      } else projects.push({ ...identity, viewIds: [viewId] });
    }
    if (JSON.stringify(before) !== JSON.stringify(await ids())) throw Error('PROJECT_VIEW_TOPOLOGY_CHANGED');
    return { status: 'pass', scope: 'project_views', projects, viewCount: before.length };
  };
  const first = await collect(), second = await collect();
  const identity = (snapshot: OpenProjects) => JSON.stringify(snapshot.projects.map(project => ({...project,path:normalizeHostPath(project.path)})));
  if (identity(first) !== identity(second)) throw Error('PROJECT_VIEW_MAPPING_CHANGED');
  return second;
}

/** One host instance owns its close boundary. A native Promise is never raced
 * against a timer. Only a settled close can time out waiting for its event.
 * Failed proof quarantines subsequent native work until explicit recovery;
 * a late event or an empty view list does not silently clear that quarantine. */
export class ProjectLifecycle {
  private state: 'ready' | 'closing' | 'unverified' = 'ready';
  constructor(private readonly api: any) {}
  get quarantined(): boolean { return this.state === 'unverified'; }
  assertReady(): void {
    if (this.state !== 'ready') throw new HostCommandError('PROJECT_LIFECYCLE_UNVERIFIED',
      'Project close is pending or unverified. Use strict project-view inspection and the existing recovery workflow; do not replay close.');
  }
  prepareClose(target: ProjectIdentity) {
    this.assertReady();
    const manager = this.api.EventManager;
    const eventName = this.api.Constants?.ProjectEvent?.CLOSED ?? this.api.ProjectClosedEvent?.EVENT_CLOSED;
    if (eventName === undefined || typeof manager?.addGlobalEventListener !== 'function' || typeof manager?.removeGlobalEventListener !== 'function')
      throw preflight('UNSUPPORTED_API', 'Verified close requires the public project CLOSED event');
    let armed = false, disposed = false;
    let closedEvent: CloseVerification['closedEvent'] = null;
    let notify: (() => void) | undefined;
    const listener = (event?: any) => {
      if (!armed || disposed) return;
      try {
        const value = { id: text(event?.id), path: text(event?.path), name: text(event?.name) };
        if (value.id === target.guid && samePath(value.path, target.path)) { closedEvent = value; notify?.(); }
      } catch { /* A malformed event is not close evidence. */ }
    };
    try { manager.addGlobalEventListener(eventName, listener); }
    catch (error) {
      disposed = true;
      try { manager.removeGlobalEventListener(eventName, listener); } catch { /* Registration may have failed before installing. */ }
      throw preflight('UNSUPPORTED_API', `Project CLOSED listener registration failed: ${String(error)}`);
    }
    const dispose = () => {
      if (disposed) return;
      disposed = true; notify = undefined;
      try { manager.removeGlobalEventListener(eventName, listener); } catch { /* Inert callback retains no native objects. */ }
    };
    return {
      dispose,
      execute: async (close: () => Promise<boolean>): Promise<{ closed: boolean | null; closeVerification: CloseVerification }> => {
        if (disposed || armed) throw new HostCommandError('PROJECT_CLOSE_WITNESS_EXPIRED','A prepared close witness can be dispatched only once');
        this.assertReady(); this.state = 'closing'; armed = true;
        let closed: boolean | null = null;
        const proof: CloseVerification = { status: 'unverified', projectId: target.guid, projectPath: target.path, closedEvent: null };
        try {
          closed = await close(); // Keep the queue owner while native close is pending.
          if (closed !== true) throw Error('PROJECT_CLOSE_NOT_ACCEPTED');
          if (!closedEvent) await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { notify = undefined; reject(Error('PROJECT_CLOSED_EVENT_MISSING')); }, 5000);
            notify = () => { clearTimeout(timer); notify = undefined; resolve(); };
            if (closedEvent) notify();
          });
          proof.closedEvent = closedEvent;
          // Let the event callback return before a fresh native inventory read.
          // This yield is ordering, not a claim about native teardown duration.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          proof.openProjects = await readOpenProjects(this.api);
          if (proof.openProjects.projects.some(project => samePath(project.path, target.path))) throw Error('PROJECT_CLOSE_TARGET_STILL_PRESENT');
          proof.status = 'pass'; this.state = 'ready';
        } catch (error) {
          proof.closedEvent = closedEvent;
          proof.reason = error instanceof Error ? error.message : String(error);
          this.state = 'unverified';
        } finally { dispose(); }
        return { closed, closeVerification: proof };
      },
    };
  }
}
