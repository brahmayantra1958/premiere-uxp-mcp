import {describe,it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';

describe('large project mutation readback',()=>{
  it.each([false,true])('verifies imports beyond 500 entries and preserves a real missing import (%s)',async missing=>{
    const items:any[]=Array.from({length:510},(_,i)=>({name:'media'+i,getId:()=> 'm'+i}));
    const root={getId:()=> 'root',getItems:()=>items},sourcePath='C:/source/voice.wav';
    const project={guid:'p',path:'C:/work.prproj',getActiveSequence:()=>({guid:'s',name:'S'}),getRootItem:()=>root,
      importFiles:vi.fn(()=>{if(!missing)items.push({name:'voice',getId:()=> 'new',getMediaFilePath:()=>sourcePath});return true;})};
    const load=uxpModules({Project:{getActiveProject:()=>project},FolderItem:{cast:(item:any)=>item===root?item:null},ClipProjectItem:{cast:(item:any)=>item}});
    const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
    const result=await new PremiereHost().dispatchCommand({command:'import_media',args:{expectedProjectId:'p',expectedSequenceId:'s',filePaths:[sourcePath]}});
    expect(result.status).toBe(missing?'fail':'pass');expect(project.importFiles).toHaveBeenCalledTimes(1);
    if(!missing)expect(result.after.importedItems).toEqual([expect.objectContaining({id:'new',path:sourcePath})]);
    else expect(result.errors[0]).toContain('Imported path missing');
  });
  it.each(['none','sequence','project','name'])('verifies the pinned sequence rename while rejecting unrelated target drift (%s)',async drift=>{
    const sequence={guid:'s',name:'Old'};
    const item={name:'Old',getId:()=> 'sequence-item',isSequence:()=>true,getSequence:()=>sequence,createSetNameAction:(name:string)=>()=>{item.name=name;sequence.name=name;}};
    const root={getId:()=> 'root',getItems:()=>[item]};
    const project={guid:'p',path:'C:/test.prproj',getActiveSequence:()=>sequence,getSequences:()=>[sequence],getRootItem:()=>root,lockedAccess:(f:any)=>f(),executeTransaction:(f:any)=>{
      f({addAction:(a:any)=>a()});if(drift==='sequence')sequence.guid='other';if(drift==='project')project.guid='other';if(drift==='name')sequence.name='Unexpected';return true;
    }};
    const load=uxpModules({Project:{getActiveProject:()=>project},FolderItem:{cast:(i:any)=>i===root?i:null},ClipProjectItem:{cast:(i:any)=>i}});
    load('apps/uxp-plugin/src/work-follow.ts').workFollow.enabled=false;
    const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
    const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'Old',renames:[{projectItemId:'sequence-item',name:'New'}]};
    const run=new PremiereHost().dispatch({id:'rename',command:'rename_project_items',args});
    if(drift==='none')expect(await run).toMatchObject({status:'pass',after:[{id:'sequence-item',name:'New'}]});
    else await expect(run).rejects.toMatchObject({code:drift==='project'?'PROJECT_PRECONDITION_FAILED':'SEQUENCE_PRECONDITION_FAILED'});
    expect(args.expectedSequenceName).toBe('Old');
  });
  it('renames and moves a late item with exact ID readback after a parent change',async()=>{
    const late:any={name:'Old',getId:()=> 'late',createSetNameAction:(name:string)=>()=>{late.name=name;}};
    const moved:any[]=[],rootItems:any[]=[...Array.from({length:510},(_,i)=>({name:'media'+i,getId:()=> 'm'+i})),late];
    const destination={name:'Destination',getId:()=> 'dest',getItems:()=>moved};rootItems.push(destination);
    const root={getId:()=> 'root',getItems:()=>rootItems,createMoveItemAction:(item:any)=>()=>{rootItems.splice(rootItems.indexOf(item),1);moved.push(item);}};
    const project={guid:'p',path:'C:/work.prproj',getActiveSequence:()=>({guid:'s',name:'S'}),getRootItem:()=>root,lockedAccess:(f:any)=>f(),executeTransaction:(f:any)=>{f({addAction:(a:any)=>a()});return true;}};
    const load=uxpModules({Project:{getActiveProject:()=>project},FolderItem:{cast:(item:any)=>item.getItems?item:null},ClipProjectItem:{cast:()=>null}});
    const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts'),host=new PremiereHost(),pin={expectedProjectId:'p',expectedSequenceId:'s'};
    const renamed=await host.dispatchCommand({command:'rename_project_items',args:{...pin,renames:[{projectItemId:'late',name:'New'}]}});
    expect(renamed).toMatchObject({status:'pass',after:[{id:'late',name:'New'}]});
    const movedResult=await host.dispatchCommand({command:'move_project_items',args:{...pin,projectItemIds:['late'],targetBinId:'dest'}});
    expect(movedResult).toMatchObject({status:'pass',after:[{id:'late',parentId:'dest'}]});
  });
  it.each([false,true])('creates a late nested bin when FolderItem loses ProjectItem identity: %s',async castDropsIdentity=>{
    let generation=0;
    const children:any[]=[];
    const wrap=()=>{const born=generation;return {name:'Late parent',getId:()=> 'late-parent',getItems:()=>{
      if(born!==generation)throw Error('The script object is no longer valid');return children;
    },createBinAction:(name:string)=>()=>{children.push({name,getId:()=> 'new-bin',getItems:()=>[]});}};};
    const root={getId:()=> 'root',getItems:()=>[...Array.from({length:530},(_,i)=>({name:'media'+i,getId:()=> 'm'+i})),wrap()]};
    const sequence={guid:'s',name:'S'};
    const project={guid:'p',path:'C:/work.prproj',getRootItem:()=>root,getActiveSequence:()=>sequence,lockedAccess:(f:any)=>f(),executeTransaction:(f:any)=>{const actions:any[]=[];f({addAction:(a:any)=>actions.push(a)});actions.forEach(a=>a());generation++;return true;}};
    const load=uxpModules({Project:{getActiveProject:()=>project},FolderItem:{cast:(item:any)=>!item.getItems?null:castDropsIdentity?{name:item.name,getItems:item.getItems,createBinAction:item.createBinAction}:item},ClipProjectItem:{cast:()=>null}});
    const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
    const host=new PremiereHost();
    const receipt=await host.dispatchCommand({command:'create_bin',args:{expectedProjectId:'p',expectedSequenceId:'s',parentBinId:'late-parent',name:'Created'}});
    expect(receipt).toMatchObject({status:'pass',after:{id:'new-bin',parentId:'late-parent',name:'Created'}});
    expect(children).toHaveLength(1);
  });
  it('rejects the wrong active sequence before returning any inspection content',async()=>{
    const scan=vi.fn(),sequence={guid:'copy',name:'Copy'},project={guid:'p',getActiveSequence:()=>sequence};
    const load=uxpModules({Project:{getActiveProject:()=>project}});
    const {followTimelineWork}=load('apps/uxp-plugin/src/host-work-target.ts');
    await expect(followTimelineWork({id:'r',command:'inspect_sequence',args:{expectedProjectId:'p',expectedSequenceId:'original'}},vi.fn(),scan,vi.fn()))
      .rejects.toMatchObject({code:'SEQUENCE_PRECONDITION_FAILED',details:{contentDispatched:false,actualTarget:{sequenceId:'copy'}}});
    expect(scan).not.toHaveBeenCalled();
  });
});
