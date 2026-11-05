import {describe,it,expect,vi} from 'vitest';
const shared=vi.hoisted(()=>({reveal:vi.fn()}));
vi.mock('../../apps/uxp-plugin/src/host-work-target.js',()=>({followTimelineWork:async(_r:any,_select:any,run:()=>Promise<any>)=>run()}));
vi.mock('../../apps/uxp-plugin/src/host-context.js',()=>({ppro:{},uxp:{},inspectHostContext:async()=>({activeProject:true,activeSequence:true,projectPath:"C:/test.prproj",projectId:"p",sequenceId:"s",sequenceName:"s"})}));
vi.mock('../../apps/uxp-plugin/src/host-project-work.js',()=>({revealProjectItem:(...args:any[])=>shared.reveal(...args)}));
import {PremiereHost} from '../../apps/uxp-plugin/src/premiere-host.js';
import {workFollow} from '../../apps/uxp-plugin/src/work-follow.js';
function host(){const h=new PremiereHost() as any;h.prepareNativeEffectTime=vi.fn();h.revealPanel=vi.fn(async()=>({status:'pass',panel:'project'}));return h;}
describe('automatic Project panel selection',()=>{
 it('selects the first edited Project item before dispatch',async()=>{
  shared.reveal.mockReset().mockResolvedValue({status:'pass',selectedIds:['item-a']});
  const h=host(),order:string[]=[];shared.reveal.mockImplementation(async()=>{order.push('select');return {status:'pass'};});
  h.dispatchCommand=vi.fn(async()=>{order.push('edit');return {status:'pass',hostResult:{}};});
  const result=await h.dispatch({version:1,id:'one',command:'set_project_item_labels',args:{labels:[{projectItemId:'item-a',colorLabelIndex:2},{projectItemId:'item-b',colorLabelIndex:2}]},timeoutMs:1000});
  expect(order).toEqual(['select','edit']);expect(shared.reveal.mock.calls[0][1]).toBe('item-a');
  expect(result).toMatchObject({status:'pass',visibility:{panel:'project',projectItemSelection:{status:'pass'}}});
 });
 it('selects the first targeted query_media result and leaves an empty page alone',async()=>{
  shared.reveal.mockReset().mockResolvedValue({status:'pass'});
  const h=host();h.dispatchCommand=vi.fn(async()=>({items:[{id:'media-1'},{id:'media-2'}]}));
  const result=await h.dispatch({version:1,id:'one',command:'query_media',args:{ids:['media-1']},timeoutMs:1000});
  expect(shared.reveal).toHaveBeenCalledOnce();expect(shared.reveal.mock.calls[0][1]).toBe('media-1');expect(result.visibility.projectItemSelection.status).toBe('pass');
  h.dispatchCommand=vi.fn(async()=>({items:[]}));
  expect((await h.dispatch({version:1,id:'two',command:'query_media',args:{ids:['missing']},timeoutMs:1000})).visibility).toBeUndefined();
  expect(h.revealPanel).toHaveBeenCalledOnce();
 });
 it('does not replace the final native panel during media or effect inventory reads',async()=>{
  shared.reveal.mockReset();
  const h=host();h.revealEffect=vi.fn();h.dispatchCommand=vi.fn(async()=>({items:[{id:'media-1',components:[{componentIndex:0}]}]}));
  for(const command of ['query_media','inspect_effects','query_timeline'])await h.dispatch({version:1,id:command,command,args:{includeEffects:true},timeoutMs:1000});
  expect(shared.reveal).not.toHaveBeenCalled();expect(h.revealPanel).not.toHaveBeenCalled();expect(h.revealEffect).not.toHaveBeenCalled();
 });
 it('never blocks or flips a Project edit when selection fails',async()=>{
  shared.reveal.mockReset().mockRejectedValue(Error('CEP helper offline'));
  const h=host();h.dispatchCommand=vi.fn(async()=>({status:'pass'}));
  const result=await h.dispatch({version:1,id:'one',command:'rename_project_items',args:{renames:[{projectItemId:'item-a',name:'new'}]},timeoutMs:1000});
  expect(h.dispatchCommand).toHaveBeenCalledOnce();expect(result).toMatchObject({status:'pass',visibility:{projectItemSelection:{status:'unverified',reason:'CEP helper offline'}}});
 });
 it('leaves the Project panel alone when automatic follow is turned off',async()=>{
  shared.reveal.mockReset();workFollow.enabled=false;
  try{const h=host();h.dispatchCommand=vi.fn(async()=>({items:[{id:'media-1'}]}));await h.dispatch({version:1,id:'one',command:'query_media',args:{},timeoutMs:1000});
   expect(shared.reveal).not.toHaveBeenCalled();expect(h.revealPanel).not.toHaveBeenCalled();}
  finally{workFollow.enabled=true;}
 });
});
