import {beforeEach,describe,it,expect,vi} from 'vitest';
import {deriveEffectHeaderBinding} from '@premiere-uxp/contracts/effect-disclosure';
const mock=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('../../apps/mcp-server/src/native-effect-worker.js',()=>({runNativeEffectAdapter:mock.run}));
vi.mock('node:fs/promises',()=>({readFile:async(file:string)=>{if(String(file).endsWith('native-visual-instance.json'))return JSON.stringify({connected:true,premierePid:10});throw Error('No optional CEP configuration');}}));
import {requestEffectDisclosure as scopedRequestEffectDisclosure,type EffectDisclosureSession} from '../../apps/mcp-server/src/effect-disclosure-bridge.js';
import {withEditTarget} from '../../apps/mcp-server/src/active-edit-target.js';
const requestEffectDisclosure=(...args:Parameters<typeof scopedRequestEffectDisclosure>)=>withEditTarget({projectPath:'C:/fixture.prproj',projectId:'project',sequenceId:'seq',sequenceName:'WORKING__test'},()=>scopedRequestEffectDisclosure(...args));
const work={sequenceName:'WORKING__test',trackItemId:'video:0:100:source',componentMatchNames:['vendor.effect'],parameter:{paramIndex:0,name:'Value',expanded:true,disclosureKey:'ECP.Slider.Expanded' as const},target:{mediaType:'video' as const,trackIndex:0,startTicks:'100',endTicks:'200',clipName:'clip',mediaPath:'C:\\clip.mov',componentMatchName:'vendor.effect',componentIndex:0,parameterCount:1,disclosureScope:'component' as const}};
const observation=(expanded:boolean)=>({protocol:1,status:'pass',route:'windows_msaa_effect_state',premierePid:10,panelHandle:20,selectedClipTab:'WORKING__test • clip',headers:[{role:43,state:expanded?8:0,top:180,height:14}],viewport:{role:3,top:153,height:402},hints:{handle:20,count:20,headers:[4],parameters:[6]}});
const binding=deriveEffectHeaderBinding(work,observation(false),observation(true))!;
const fresh={...observation(true),binding};
const row={protocol:1,status:'pass',route:'windows_msaa_parameter_state',premierePid:10,panelHandle:20,selectedClipTab:'WORKING__test • clip',headerIndex:0,rows:[{index:6,ordinal:0,role:43,state:8,top:200,height:14,width:14}],viewport:{top:153,height:402},dispatchAccepted:false};
beforeEach(()=>mock.run.mockReset());
describe('same-command header hints with independent native parameter proof',()=>{
 it('uses the verified tree only to address a fresh parameter read, never to skip it',async()=>{
  const session:EffectDisclosureSession={binding,parameterHints:fresh};mock.run.mockResolvedValue(row);
  await requestEffectDisclosure('parameter_inspect',work,session);
  expect(mock.run.mock.calls.map(c=>c[0])).toEqual(['parameter']);expect(JSON.parse(Buffer.from(mock.run.mock.calls[0]![1][0],'base64').toString()).hints.handle).toBe(20);
 });
 it('reacquires a changed layout once after a finished non-action rejection',async()=>{
  const session:EffectDisclosureSession={binding,parameterHints:fresh};mock.run.mockResolvedValueOnce({status:'unverified',reason:'PARAMETER_LAYOUT_CHANGED',dispatchAccepted:false}).mockResolvedValueOnce(fresh).mockResolvedValueOnce(row);
  expect((await requestEffectDisclosure('parameter_inspect',work,session)).status).toBe('pass');
  expect(mock.run.mock.calls.map(c=>c[0])).toEqual(['parameter','state','parameter']);
 });
 it.each([{status:'unverified',reason:'NATIVE_WORKER_TIMEOUT_DO_NOT_REPLAY'},{status:'unverified',reason:'PARAMETER_LAYOUT_CHANGED',dispatchAccepted:true}])('does not retry uncertain work or infer PASS from hints',async failure=>{
  mock.run.mockResolvedValue(failure);const session={binding,parameterHints:fresh};
  expect((await requestEffectDisclosure('parameter_inspect',work,session)).status).toBe('unverified');expect(mock.run).toHaveBeenCalledTimes(1);
 });
});
