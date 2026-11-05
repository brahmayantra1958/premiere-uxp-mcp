import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {BridgeClient} from '../../apps/uxp-plugin/src/bridge-client.js';
import type {BridgeAuthentication} from '../../apps/uxp-plugin/src/wire.js';

class Socket extends EventTarget {
  static instances: Socket[] = [];
  private state = 0;
  stateThrows = false;
  get readyState(): number { if (this.stateThrows) throw Error('retired native socket'); return this.state; }
  set readyState(state: number) { this.state = state; }
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  readonly order: string[] = [];
  removeFailure: string | undefined;
  send = vi.fn();
  close = vi.fn(() => { this.order.push('close-request'); this.readyState = 2; });
  constructor() { super(); Socket.instances.push(this); }
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    this.order.push(`add:${type}`);
    if (callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(callback);
    }
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    this.order.push(`remove:${type}`);
    if (this.removeFailure === type) throw Error('native listener removal failed');
    if (callback) this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  count(): number { return [...this.listeners.values()].reduce((sum, values) => sum + values.size, 0); }
  open(): void { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  receive(value: unknown): void { this.dispatchEvent(Object.assign(new Event('message'), {data: JSON.stringify(value)})); }
  finishClose(code = 1000): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), {code, reason: 'test close'}));
  }
}
const authentication: BridgeAuthentication = {method: 'project_credential', projectId: 'project', credential: 'a'.repeat(64)};
const authResponse = {version: 1, type: 'authenticated', ok: true, projectId: 'project', credentialIssued: false, nativePanelProtocol: 1};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(dispatch = vi.fn(async (): Promise<unknown> => ({status: 'pass'}))) {
  const status = vi.fn(), log = vi.fn(), authenticated = vi.fn(), closed = vi.fn(), task = vi.fn();
  const client = new BridgeClient(dispatch, status, log, authenticated, closed, task);
  client.connect('ws://localhost:8099', authentication);
  return {client, socket: Socket.instances.at(-1)!, dispatch, status, log, authenticated, closed, task};
}
beforeEach(() => {
  vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('synchronous bridge callback release', () => {
  it('removes ordinary disconnect listeners before close and guards already queued callbacks', async () => {
    const {client, socket, dispatch, closed} = fixture();
    const queued = [...socket.listeners.entries()].map(([type, callbacks]) => [type, [...callbacks][0]!] as const);
    client.disconnect();
    expect(socket.count()).toBe(0);
    expect(socket.order.slice(-5)).toEqual(['remove:open', 'remove:close', 'remove:error', 'remove:message', 'close-request']);
    for (const [type, callback] of queued) {
      const event = Object.assign(new Event(type), {code: 1006, reason: 'late', data: JSON.stringify({version: 1, id: 'late', command: 'save_working_project', args: {}})});
      if (typeof callback === 'function') callback.call(socket, event); else callback.handleEvent(event);
    }
    await flush();
    expect(socket.send).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled();
    client.connect('ws://localhost:8099', authentication);
    expect(Socket.instances).toHaveLength(2); expect(Socket.instances[1]!.count()).toBe(4);
    client.disconnect();
  });
  it('removes remote-close listeners and notifies ordinary recovery exactly once', () => {
    const {client, socket, closed} = fixture(); socket.finishClose(1006);
    expect(socket.count()).toBe(0);
    expect(closed).toHaveBeenCalledExactlyOnceWith({code: 1006, reason: 'test close', wasAuthenticated: false});
    socket.finishClose(1006); expect(closed).toHaveBeenCalledTimes(1);
    client.connect('ws://localhost:8099', authentication); client.disconnect();
  });
  it('returns synchronously with zero new observers/timers and no transport-completion claim', async () => {
    const {client, socket, status, log, closed} = fixture();
    const counts = {status: status.mock.calls.length, log: log.mock.calls.length};
    const add = vi.spyOn(socket, 'addEventListener'), schedule = vi.spyOn(globalThis, 'setTimeout');
    const result = client.dispose();
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toMatchObject({status: 'pass', scope: 'callback_release', sockets: 1, closeRequested: 1, closedAtRead: 0, closingAtRead: 0, registeredSocketListenersReleased: true});
    expect(result).not.toHaveProperty('closeEvents'); expect(result).not.toHaveProperty('closedSockets');
    expect(client.dispose()).toBe(result);
    expect(() => client.connect('ws://localhost:8099', authentication)).toThrow('BRIDGE_DISPOSED');
    expect(add).not.toHaveBeenCalled(); expect(schedule).not.toHaveBeenCalled();
    expect(socket.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
    const diagnostics = vi.mocked(console.info).mock.calls.length;
    socket.dispatchEvent(new Event('error')); socket.finishClose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.mocked(console.info)).toHaveBeenCalledTimes(diagnostics);
    expect(client.dispose()).toBe(result); expect(result.closedAtRead).toBe(0);
    expect(status).toHaveBeenCalledTimes(counts.status); expect(log).toHaveBeenCalledTimes(counts.log); expect(closed).not.toHaveBeenCalled();
  });
  it.each([0, 1])('requests one close for state %s without waiting for an event', state => {
    const {client, socket} = fixture(); socket.readyState = state;
    expect(client.dispose()).toMatchObject({status: 'pass', closeRequested: 1, closedAtRead: 0});
    client.dispose(); expect(socket.close).toHaveBeenCalledExactlyOnceWith(1000, 'plugin destroyed');
    expect(socket.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([2, 3])('does not request another close for state %s', state => {
    const {client, socket} = fixture(); socket.readyState = state;
    expect(client.dispose()).toMatchObject({status: 'pass', closeRequested: 0, closedAtRead: state === 3 ? 1 : 0, closingAtRead: state === 2 ? 1 : 0});
    expect(socket.close).not.toHaveBeenCalled(); expect(socket.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not retain or reread an old socket after ordinary disconnect', () => {
    const {client, socket: old} = fixture(); client.disconnect(); old.stateThrows = true;
    client.connect('ws://localhost:8099', authentication);
    const current = Socket.instances[1]!;
    expect(client.dispose()).toMatchObject({status: 'pass', sockets: 1, closeRequested: 1, errors: []});
    expect(old.close).toHaveBeenCalledTimes(1); expect(current.close).toHaveBeenCalledTimes(1);
    expect(old.count() + current.count()).toBe(0);
  });
  it('does not equate a synchronous close event with an observed teardown close', () => {
    const {client, socket} = fixture(); socket.close.mockImplementation(() => { socket.finishClose(); });
    expect(client.dispose()).toMatchObject({status: 'pass', scope: 'callback_release', closeRequested: 1, closedAtRead: 0});
    expect(socket.count()).toBe(0);
    expect(vi.mocked(console.info).mock.calls.some(call => String(call[1]).includes('close-observed'))).toBe(false);
  });
  it('reports unreadable native state without trying close or registering replacement observers', () => {
    const {client, socket} = fixture(); socket.stateThrows = true;
    expect(client.dispose()).toMatchObject({status: 'unverified', closeRequested: 0, errors: ['socket_state_unavailable']});
    expect(socket.close).not.toHaveBeenCalled(); expect(socket.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['state', 'close'] as const)('retains ordinary disconnect %s failure without repeating native close on dispose', failure => {
    const {client, socket} = fixture();
    if (failure === 'state') socket.stateThrows = true;
    else socket.close.mockImplementation(() => { throw Error('close failed'); });
    expect(() => client.disconnect()).not.toThrow();
    const requests = socket.close.mock.calls.length;
    expect(client.dispose()).toMatchObject({status: 'unverified', sockets: 0, closeRequested: 0, errors: [failure === 'state' ? 'socket_state_unavailable' : 'socket_close_failed']});
    expect(socket.close).toHaveBeenCalledTimes(requests); expect(socket.count()).toBe(0);
  });
  it('reports a throwing close as an attempted request, without rereading the invalidated native getter', () => {
    const {client, socket} = fixture();
    socket.close.mockImplementation(() => { socket.stateThrows = true; throw Error('close failed'); });
    expect(client.dispose()).toMatchObject({status: 'unverified', closeRequested: 1, closedAtRead: 0, errors: ['socket_close_failed']});
    expect(socket.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps failed listener removal unverified while guarding the stale message handler', async () => {
    const {client, socket, dispatch} = fixture(); socket.removeFailure = 'message';
    expect(client.dispose()).toMatchObject({status: 'unverified', registeredSocketListenersReleased: false, errors: ['socket_listener_cleanup_failed']});
    socket.receive({version: 1, id: 'late', command: 'save_working_project', args: {}});
    await flush(); expect(dispatch).not.toHaveBeenCalled();
  });
  it('settles existing visibility as unverified while registering no disposal work', async () => {
    const {client, socket, dispatch} = fixture(); socket.open(); socket.receive(authResponse); await flush();
    const visibility = client.requestNativeVisibility('parent', 'timeline', 'project', 'sequence');
    const schedule = vi.spyOn(globalThis, 'setTimeout'), add = vi.spyOn(socket, 'addEventListener');
    expect(client.dispose()).toMatchObject({status: 'pass', scope: 'callback_release', pendingVisibilityRequests: 1});
    await expect(visibility).resolves.toMatchObject({status: 'unverified', reason: 'Panel disconnected during native visibility'});
    expect(dispatch).not.toHaveBeenCalled(); expect(schedule).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('suppresses late UI callbacks from an existing authentication continuation', async () => {
    let finishAuth!: () => void;
    const auth = new Promise<void>(resolve => { finishAuth = resolve; });
    const status = vi.fn(), log = vi.fn(), closed = vi.fn();
    const client = new BridgeClient(async () => ({}), status, log, () => auth, closed);
    client.connect('ws://localhost:8099', authentication);
    const socket = Socket.instances[0]!; socket.open(); socket.receive(authResponse);
    const counts = {status: status.mock.calls.length, log: log.mock.calls.length};
    client.dispose(); finishAuth(); await flush();
    expect(status).toHaveBeenCalledTimes(counts.status); expect(log).toHaveBeenCalledTimes(counts.log); expect(closed).not.toHaveBeenCalled();
  });
  it('preserves unresolved mutation state and later actual receipt without cancellation, replay, or promotion', async () => {
    let finishHost!: (value: unknown) => void;
    const host = new Promise<unknown>(resolve => { finishHost = resolve; });
    const dispatch = vi.fn(() => host);
    const {client, socket, task} = fixture(dispatch); socket.open(); socket.receive(authResponse); await flush();
    socket.receive({version: 1, id: 'write', command: 'save_working_project', args: {}, timeoutMs: 1000}); await flush();
    const ledger = (client as unknown as {execution: {inspect(ids: string[]): {commands: {state: string; response?: {result: unknown}}[]}}}).execution;
    const tasks = task.mock.calls.length, result = client.dispose();
    expect(result).toMatchObject({status: 'unverified', activeCommands: 1, errors: ['host_commands_still_pending']});
    expect(ledger.inspect(['write']).commands[0]).toMatchObject({state: 'running'});
    expect(ledger.inspect(['write']).commands[0]!.response).toBeUndefined();
    const actualResult = {status: 'unverified', proof: 'native result remains unknown'};
    finishHost(actualResult); await flush();
    expect(ledger.inspect(['write']).commands[0]).toMatchObject({state: 'complete', response: {result: actualResult}});
    expect(dispatch).toHaveBeenCalledTimes(1); expect(task).toHaveBeenCalledTimes(tasks);
    expect(client.dispose()).toBe(result); expect(result.activeCommands).toBe(1); expect(result.status).toBe('unverified');
  });
});
