import {EventEmitter} from "node:events";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
const f=vi.hoisted(()=>({read:vi.fn(),connect:vi.fn(),observe:vi.fn()}));
vi.mock("node:fs/promises",()=>({readFile:f.read}));
vi.mock("node:net",()=>({createConnection:f.connect}));
vi.mock("../../apps/mcp-server/src/native-tool-state.js",()=>({readNativeToolState:f.observe}));
import {requestNativeVisual} from "../../apps/mcp-server/src/native-visual-bridge.js";
import {nativeVisualFeatureForCommand} from "../../packages/contracts/src/panel-work.js";
const id="12345678-abcd-abcd-abcd-123456789abc";
const actualPlatform = process.platform;
afterEach(()=>{Object.defineProperty(process, 'platform', { value: actualPlatform });});
let socket:EventEmitter&{setEncoding:ReturnType<typeof vi.fn>;write:ReturnType<typeof vi.fn>;destroy:ReturnType<typeof vi.fn>};
beforeEach(()=>{
 Object.defineProperty(process, 'platform', { value: 'win32' });
 vi.clearAllMocks();f.read.mockImplementation(async(p:string)=>JSON.stringify(p.endsWith("config.json")?{token:"a".repeat(64)}:{protocol:1,premierePid:123,connected:true}));
 f.observe.mockResolvedValue({status:"unsupported"});
 socket=Object.assign(new EventEmitter(),{setEncoding:vi.fn(),write:vi.fn(),destroy:vi.fn()});f.connect.mockReturnValue(socket);
});
async function sent(){await vi.waitFor(()=>expect(f.connect).toHaveBeenCalledOnce());socket.emit("connect");}
describe("bounded SDK transport and truthful receipts",()=>{
 it('reports macOS unsupported without opening a Windows named pipe', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  await expect(requestNativeVisual('inspect', id)).resolves.toMatchObject({ status: 'unsupported', contentDispatched: false });
  expect(f.connect).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
 });
 it("proves an accepted SDK request with independent native selection readback",async()=>{
  f.observe.mockResolvedValue({protocol:1,status:"pass",route:"windows_msaa_tool_state",premierePid:123,panel:"Tools",selectedTools:[{name:"선택 도구",role:43,state:8}]});
  const pending=requestNativeVisual("selection_tool",id);await sent();socket.emit("data",JSON.stringify({protocol:1,id,premierePid:123,status:"unverified",feature:"selection_tool",dispatchAccepted:true,sdkError:0})+'\n');
  await expect(pending).resolves.toMatchObject({status:"pass",readback:{premierePid:123}});expect(f.observe).toHaveBeenCalledExactlyOnceWith(123);
 });
 it("keeps accepted execution unverified when the native toolbar differs",async()=>{
  f.observe.mockResolvedValue({protocol:1,status:"pass",route:"windows_msaa_tool_state",premierePid:123,panel:"Tools",selectedTools:[{name:"자르기 도구",role:43,state:8}]});
  const pending=requestNativeVisual("selection_tool",id);await sent();socket.emit("data",JSON.stringify({protocol:1,id,premierePid:123,status:"unverified",dispatchAccepted:true,sdkError:0})+'\n');
  await expect(pending).resolves.toMatchObject({status:"unverified"});
 });
 it("never maps unknown commands/tools to a native action",()=>{
  expect(nativeVisualFeatureForCommand("activate_native_tool",{tool:"object_selection"})).toBe("object_selection_tool");
  expect(nativeVisualFeatureForCommand("set_effect_values",{tool:"razor"})).toBeUndefined();
  expect(nativeVisualFeatureForCommand("activate_native_tool",{tool:"cmd.file.exit"})).toBeUndefined();
 });
 it("does not dispatch without an installed connected instance",async()=>{
  f.read.mockRejectedValue(new Error("absent"));await expect(requestNativeVisual("inspect",id)).resolves.toMatchObject({status:"unsupported"});expect(f.connect).not.toHaveBeenCalled();
 });
 it("assembles split replies and binds the reply to process and request",async()=>{
  const pending=requestNativeVisual("selection_tool",id);await sent();expect(socket.write).toHaveBeenCalledWith(`${"a".repeat(64)}\t${id}\tselection_tool\n`);
  socket.emit("data",`{"protocol":1,"id":"${id}",`);socket.emit("data",'"premierePid":123,"status":"unverified","feature":"selection_tool"}\n');
  await expect(pending).resolves.toMatchObject({status:"unverified",feature:"selection_tool"});expect(socket.destroy).toHaveBeenCalledOnce();
 });
 it.each([{status:"pass"},{premierePid:456},{id:"other"},{feature:"razor_tool"}])("rejects unproved success or mismatched replies: %j",async(extra)=>{
  const pending=requestNativeVisual("selection_tool",id);await sent();socket.emit("data",JSON.stringify({protocol:1,id,premierePid:123,status:"unverified",...extra})+'\n');
  await expect(pending).resolves.toMatchObject({status:"unverified",reason:expect.any(String)});
 });
 it("classifies incomplete replies after dispatch without retrying",async()=>{
  const pending=requestNativeVisual("selection_tool",id);await sent();socket.emit("data",'{');socket.emit("end");
  await expect(pending).resolves.toMatchObject({status:"unverified",reason:"NATIVE_VISUAL_INCOMPLETE_RESPONSE"});expect(f.connect).toHaveBeenCalledOnce();
 });
 it("rejects unallowlisted features before touching the runtime",async()=>{
  await expect(requestNativeVisual("exec" as any,id)).rejects.toThrow("INVALID");expect(f.read).not.toHaveBeenCalled();
 });
});
