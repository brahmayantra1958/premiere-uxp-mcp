import { afterEach, describe, expect, it, vi } from 'vitest';
import { uxpModules } from '../helpers/uxp-modules.js';
import { ProjectLifecycle, readOpenProjects } from '../../apps/uxp-plugin/src/host-project-lifecycle.js';
import { verifiedProjectClose } from '../../apps/mcp-server/src/project-lifecycle-preflight.js';

const target = { guid: 'project', path: 'C:/target.prproj', name: 'Target' };
const other = { guid: 'other', path: 'C:/other.prproj', name: 'Other' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(extra = false) {
  const state = {
    projects: [{ ...target, viewIds: ['target-view'] }, ...(extra ? [{ ...other, viewIds: ['other-view'] }] : [])],
    closed: false, eventMode: 'during' as 'during' | 'manual' | 'missing' | 'wrong' | 'throw',
    keepTarget: false, inventoryFailure: false,
    pendingClose: undefined as Promise<boolean> | undefined,
  };
  const listeners = new Set<(event: unknown) => void>();
  const emit = (identity = target) => { for (const listener of listeners) listener({ id: identity.guid, path: identity.path, name: identity.name }); };
  const sequence = { guid: 'sequence', name: 'Sequence', clearSelection: async () => {}, getSelection: async () => ({ getTrackItems: async () => [] }) };
  const save = vi.fn(async () => true);
  const close = vi.fn(async () => {
    state.closed = true;
    if (!state.keepTarget) state.projects = state.projects.filter(project => project.path !== target.path);
    if (state.eventMode === 'during') emit();
    if (state.eventMode === 'wrong') emit(other);
    if (state.eventMode === 'throw') throw Error('CLOSE_APPLIED_THEN_FAILED');
    return state.pendingClose ? await state.pendingClose : true;
  });
  const project = () => {
    const check = () => { if (state.closed) throw Error('CLOSED_WRAPPER_ACCESSED'); };
    return {
      get guid() { check(); return target.guid; }, get path() { check(); return target.path; }, get name() { check(); return target.name; },
      getActiveSequence: async () => { check(); return sequence; }, getSequences: async () => { check(); return [sequence]; }, save, close,
    };
  };
  const getActiveProject = vi.fn(async () => state.closed ? null : project());
  const ppro = {
    Project: { getActiveProject }, Guid: { fromString: vi.fn((value: string) => ({ value })) },
    ProjectUtils: {
      getProjectViewIds: vi.fn(async () => {
        if (state.closed && state.inventoryFailure) throw Error('INVENTORY_FAILED');
        return state.projects.flatMap(value => value.viewIds.map(id => ({ toString: () => id })));
      }),
      getProjectFromViewId: vi.fn(async (guid: { value: string }) => state.projects.find(value => value.viewIds.includes(guid.value))),
    },
    Constants: { ProjectEvent: { CLOSED: 1 } },
    EventManager: {
      addGlobalEventListener: vi.fn((_name: unknown, listener: (event: unknown) => void) => { listeners.add(listener); }),
      removeGlobalEventListener: vi.fn((_name: unknown, listener: (event: unknown) => void) => { listeners.delete(listener); }),
    },
    CloseProjectOptions: class {
      setPromptIfDirty() { return this; } setShowCancelButton() { return this; } setSaveWorkspace() { return this; }
    },
  };
  return { state, ppro, emit, listeners, save, close, getActiveProject };
}

function hostFixture(extra = false) {
  const f = fixture(extra);
  const load = uxpModules(f.ppro, { Date, setTimeout, clearTimeout });
  const host = new (load('apps/uxp-plugin/src/premiere-host.ts').PremiereHost)();
  load('apps/uxp-plugin/src/work-follow.ts').workFollow.enabled = false;
  let nextId = 0;
  const dispatch = (command: string, args: Record<string, unknown> = {}) => host.dispatch({ version: 1, id: `lifecycle-${++nextId}`, command, args, timeoutMs: 120000 });
  const close = (args = {}) => dispatch('close_working_project', { projectPath: target.path, sequenceName: 'Sequence', sequenceId: 'sequence', ...args });
  return { ...f, host, dispatch, runClose: close };
}

afterEach(() => vi.useRealTimers());

describe('strict project-view snapshots', () => {
  it('detaches GUIDs and identities before each native await, groups views by GUID and path, and preserves same-GUID copies', async () => {
    let epoch = 0;
    const rows = [{ ...target, id: 'a' }, { ...target, id: 'b' }, { ...target, path: other.path, name: other.name, id: 'c' }];
    const api = { Guid: { fromString: (value: string) => ({ value }) }, ProjectUtils: {
      getProjectViewIds: async () => {
        const born = ++epoch;
        return rows.map(row => ({ toString: () => { if (born !== epoch) throw Error('STALE_GUID'); return row.id; } }));
      },
      getProjectFromViewId: async ({ value }: { value: string }) => {
        const row = rows.find(candidate => candidate.id === value)!;
        const born = ++epoch;
        const check = () => { if (born !== epoch) throw Error('STALE_PROJECT'); };
        return { get guid() { check(); return row.guid; }, get path() { check(); return row.path; }, get name() { check(); return row.name; } };
      },
    } };
    expect(await readOpenProjects(api)).toEqual({ status: 'pass', scope: 'project_views', viewCount: 3,
      projects: [{ ...target, viewIds: ['a', 'b'] }, { ...target, path: other.path, name: other.name, viewIds: ['c'] }] });
  });

  it.each(['failed', 'missing', 'changed'])('rejects incomplete or changing native inventory: %s', async fault => {
    const f = fixture();
    if (fault === 'failed') f.ppro.ProjectUtils.getProjectViewIds.mockRejectedValue(Error('FAILED'));
    if (fault === 'missing') f.ppro.ProjectUtils.getProjectFromViewId.mockResolvedValue(undefined);
    if (fault === 'changed') f.ppro.ProjectUtils.getProjectViewIds.mockResolvedValueOnce([{ toString: () => 'target-view' }]).mockResolvedValue([]);
    await expect(readOpenProjects(f.ppro)).rejects.toThrow();
  });
  it('rejects a view rebound to a different path between complete passes even when its GUID and view ID are unchanged', async () => {
    const f = fixture();
    f.ppro.ProjectUtils.getProjectFromViewId.mockResolvedValueOnce({...target,viewIds:['target-view']})
      .mockResolvedValue({...target,path:other.path,viewIds:['target-view']});
    await expect(readOpenProjects(f.ppro)).rejects.toThrow('PROJECT_VIEW_MAPPING_CHANGED');
    expect(f.ppro.ProjectUtils.getProjectFromViewId).toHaveBeenCalledTimes(2);
  });
});

describe('close evidence and native ownership', () => {
  it.each(['during', 'manual'] as const)('accepts exact CLOSED %s native Promise completion and never reads the closed wrapper', async mode => {
    vi.useFakeTimers();
    const f = hostFixture(); f.state.eventMode = mode;
    const result = f.runClose();
    await vi.advanceTimersByTimeAsync(0);
    if (mode === 'manual') { expect(f.close).toHaveBeenCalledTimes(1); f.emit(); }
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ status: 'pass', hostResult: { saved: true, closed: true, closeDispatched: true,
      closeVerification: { status: 'pass', projectId: target.guid, projectPath: target.path, closedEvent: { id: target.guid, path: target.path }, openProjects: { projects: [], viewCount: 0 } } } });
    expect(verifiedProjectClose(await result,{projectId:target.guid,projectPath:target.path,sequenceId:'sequence',sequenceName:'Sequence'})).toMatchObject({status:'pass'});
    expect(f.save).toHaveBeenCalledTimes(1); expect(f.listeners.size).toBe(0);
    expect(await f.dispatch('get_agent_context')).toMatchObject({ status: 'no_project', project: null, sequence: null });
  });

  it('keeps pending native close in the lane beyond the event deadline and queues connection reads behind its proof', async () => {
    vi.useFakeTimers();
    const f = hostFixture(), native = deferred<boolean>(); f.state.pendingClose = native.promise;
    const close = f.runClose(); await vi.advanceTimersByTimeAsync(0);
    const reads = f.getActiveProject.mock.calls.length, views = f.ppro.ProjectUtils.getProjectViewIds.mock.calls.length;
    const connection = f.host.connectionSnapshot();
    const context = f.dispatch('get_agent_context');
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.getActiveProject).toHaveBeenCalledTimes(reads);
    expect(f.ppro.ProjectUtils.getProjectViewIds).toHaveBeenCalledTimes(views);
    expect(await f.dispatch('inspect_host_activity')).toMatchObject({ commands: [expect.objectContaining({ state: 'running', command: 'close_working_project' }), expect.anything(), expect.anything()] });
    native.resolve(true); await vi.advanceTimersByTimeAsync(1);
    expect(await close).toMatchObject({ status: 'pass' });
    expect(await connection).toMatchObject({ error: expect.stringContaining('Premiere has no active project') });
    expect(await context).toMatchObject({ status: 'no_project' });
  });

  it.each(['missing', 'wrong', 'inventory', 'retained', 'throw'])('quarantines a completed uncertain close without replay: %s', async fault => {
    vi.useFakeTimers();
    const f = hostFixture();
    if (fault === 'missing' || fault === 'wrong' || fault === 'throw') f.state.eventMode = fault;
    if (fault === 'inventory') f.state.inventoryFailure = true;
    if (fault === 'retained') f.state.keepTarget = true;
    const result = f.runClose(); await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toMatchObject({ status: 'unverified', hostResult: { closeDispatched: true, closeVerification: { status: 'unverified' } } });
    const calls = f.getActiveProject.mock.calls.length;
    await expect(f.dispatch('get_agent_context')).rejects.toMatchObject({ code: 'PROJECT_LIFECYCLE_UNVERIFIED' });
    expect(await f.host.connectionSnapshot()).toMatchObject({ code: 'PROJECT_LIFECYCLE_UNVERIFIED' });
    expect(f.getActiveProject).toHaveBeenCalledTimes(calls);
    f.state.inventoryFailure = false; f.state.projects = []; f.emit();
    expect(await f.dispatch('inspect_host_context', { includeOpenProjects: true })).toMatchObject({ contextStatus: 'unknown', projectLifecycle: 'unverified', activeProject: null, openProjects: { projects: [] } });
    await expect(f.runClose()).rejects.toMatchObject({ code: 'PROJECT_LIFECYCLE_UNVERIFIED' });
    expect(f.close).toHaveBeenCalledTimes(1); expect(f.listeners.size).toBe(0);
  });

  it.each(['unavailable', 'registration'])('rejects an unsupported event route before save: %s', async fault => {
    const f = hostFixture();
    if (fault === 'unavailable') (f.ppro as any).EventManager = undefined;
    else f.ppro.EventManager.addGlobalEventListener.mockImplementation(() => { throw Error('REGISTER_FAILED'); });
    await expect(f.runClose()).rejects.toMatchObject({ code: 'UNSUPPORTED_API', details: { contentDispatched: false } });
    expect(f.save).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
  });

  it('requires exclusivity only when requested and treats a same-GUID different-path copy separately', async () => {
    vi.useFakeTimers();
    const f = hostFixture(true); f.state.projects[1]!.guid = target.guid;
    await expect(f.runClose({ requireExclusiveProject: true })).rejects.toMatchObject({ code: 'PROJECT_CLOSE_REQUIRES_EXCLUSIVE_TARGET', details: { contentDispatched: false } });
    expect(f.save).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
    const result = f.runClose(); await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ status: 'pass', before: { openProjects: { viewCount: 2 } }, hostResult: { closeVerification: { openProjects: { projects: [{ guid: target.guid, path: other.path }] } } } });
  });

  it('keeps the default context inventory-free and explicitly exposes the strict inventory when requested', async () => {
    const f = hostFixture();
    expect(await f.dispatch('inspect_host_context')).toMatchObject({ activeProject: true });
    expect(f.ppro.ProjectUtils.getProjectViewIds).not.toHaveBeenCalled();
    expect(await f.dispatch('inspect_host_context', { includeOpenProjects: true })).toMatchObject({ activeProject: true, openProjects: { status: 'pass', scope: 'project_views', viewCount: 1 } });
    expect(f.ppro.ProjectUtils.getProjectViewIds).toHaveBeenCalledTimes(4);
  });

  it('does not convert failed active-context reads to no-project evidence in an explicit strict inspection', async () => {
    const f = hostFixture();
    f.getActiveProject.mockRejectedValue(Error('NATIVE_CONTEXT_FAILED'));
    await expect(f.dispatch('inspect_host_context', { includeOpenProjects: true })).rejects.toThrow('NATIVE_CONTEXT_FAILED');
  });

  it('serializes an already-running connection read before close preflight', async () => {
    vi.useFakeTimers();
    const f = hostFixture(), active = deferred<any>();
    f.getActiveProject.mockImplementationOnce(() => active.promise);
    const connection = f.host.connectionSnapshot(); await vi.advanceTimersByTimeAsync(0);
    const close = f.runClose(); await vi.advanceTimersByTimeAsync(0);
    expect(f.getActiveProject).toHaveBeenCalledTimes(1); expect(f.close).not.toHaveBeenCalled();
    active.resolve({ ...target }); await vi.advanceTimersByTimeAsync(1);
    expect(await connection).toMatchObject({ projectId: target.guid });
    expect(await close).toMatchObject({ status: 'pass' });
  });

  it('does not consume a matching event emitted before close was dispatched', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.state.eventMode = 'missing';
    const lifecycle = new ProjectLifecycle(f.ppro), prepared = lifecycle.prepareClose(target);
    f.emit();
    const result = prepared.execute(f.close); await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toMatchObject({ closeVerification: { status: 'unverified', closedEvent: null, reason: 'PROJECT_CLOSED_EVENT_MISSING' } });
  });
  it('never dispatches a prepared close witness twice, including after successful proof', async () => {
    vi.useFakeTimers();
    const f = fixture(), prepared = new ProjectLifecycle(f.ppro).prepareClose(target);
    const result = prepared.execute(f.close); await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({closeVerification:{status:'pass'}});
    await expect(prepared.execute(f.close)).rejects.toMatchObject({code:'PROJECT_CLOSE_WITNESS_EXPIRED'});
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('checks exact path before saving and closing a project with a matching GUID', async () => {
    const f = hostFixture();
    await expect(f.runClose({projectPath:other.path})).rejects.toMatchObject({code:'ACTIVE_TARGET_MISMATCH'});
    expect(f.save).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
  });
  it('reacquires the sequence after clearing Effect Controls rather than reading the invalidated selection owner', async () => {
    vi.useFakeTimers();
    const f = hostFixture(); let generation = 0;
    const acquire = f.getActiveProject.getMockImplementation()!;
    f.getActiveProject.mockImplementation(async () => {
      const project = await acquire();
      if (!project) return null;
      return {...project,getActiveSequence:async()=>{
        const born=generation;
        return {guid:'sequence',name:'Sequence',clearSelection:async()=>{generation++;},getSelection:async()=>{
          if(born!==generation)throw Error('STALE_SELECTION_OWNER');
          return {getTrackItems:async()=>[]};
        }};
      }};
    });
    const result=f.runClose({releaseEffectControls:true}); await vi.advanceTimersByTimeAsync(2);
    expect(await result).toMatchObject({status:'pass',hostResult:{effectControlsReleased:true}});
    expect(generation).toBe(1);expect(f.close).toHaveBeenCalledTimes(1);
  });
});
