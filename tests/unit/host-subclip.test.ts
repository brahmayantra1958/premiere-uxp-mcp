import {it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';

function fixture(count:number,options:{audioOnly?:boolean;noCreate?:boolean;invalidate?:boolean}={}){
  let generation=0;
  const time=(seconds:number)=>({seconds,ticks:String(Math.round(seconds*254016000000))});
  const items:any[]=Array.from({length:count},(_,i)=>({name:'media'+i,getId:()=> 'm'+i}));
  const transaction=vi.fn((f:any)=>{const actions:any[]=[];f({addAction:(a:any)=>actions.push(a)});actions.forEach(a=>a());return true;});
  const create=vi.fn((_name:string,start:any,end:any,_hard:boolean,flags:any)=>()=>{
    expect(flags).toEqual({takeVideo:!options.audioOnly,takeAudio:true});
    if(options.noCreate)return;
    items.push({name:'Part',getId:()=> 'created',getInPoint:(type:number)=>{expect(type).toBe(options.audioOnly?2:1);return start;},getOutPoint:()=>end});
  });
  const source={name:'Source',getId:()=> 'source'};items.unshift(source);
  const root={getId:()=> 'root',getItems:()=>{generation++;return items;}};
  const project={guid:'p',path:'C:/scratch.prproj',getActiveSequence:()=>({guid:'s',name:'S'}),getRootItem:()=>root,lockedAccess:(f:any)=>f(),executeTransaction:transaction};
  const load=uxpModules({Project:{getActiveProject:()=>project},FolderItem:{cast:(i:any)=>i===root?i:null},Constants:{MediaType:{VIDEO:1,AUDIO:2}},
    ClipProjectItem:{cast:(i:any)=>{if(i!==source)return i;const born=generation;return {...source,createSubClipAction:(...args:any[])=>{
      if(options.invalidate&&born!==generation)throw Error('The script object is no longer valid');return create(...args as Parameters<typeof create>);
    }};}},TickTime:{createWithTicks:(t:string)=>({ticks:t,seconds:Number(t)/254016000000}),createWithSeconds:time}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
  return {transaction,create,run:()=>new PremiereHost().dispatchCommand({command:'create_subclip',args:{expectedProjectId:'p',expectedSequenceId:'s',projectItemId:'source',name:'Part',startSeconds:59.0172916667,endSeconds:70.5287916667,hardBoundaries:false,takeVideo:!options.audioOnly,takeAudio:true}})};
}
it.each([false,true])('finds a newly created subclip beyond 500 entries and reads the requested medium (audio only: %s)',async audioOnly=>{
  const f=fixture(510,{audioOnly});expect(await f.run()).toMatchObject({status:'pass',after:{created:{id:'created'},rangeReadback:'available'}});
  expect(f.transaction).toHaveBeenCalledTimes(1);
});
it('reacquires the source after project traversal before constructing the subclip action',async()=>{
  const f=fixture(30,{invalidate:true});expect(await f.run()).toMatchObject({status:'pass'});
  expect(f.transaction).toHaveBeenCalledTimes(1);
});
it('retains failure when Premiere accepts the transaction but creates nothing (F 97b74a36)',async()=>{
  const f=fixture(30,{noCreate:true}),result=await f.run();
  expect(result).toMatchObject({status:'fail',before:{count:31},after:{count:31}});
  expect(result.after.created).toBeUndefined();expect(f.transaction).toHaveBeenCalledTimes(1);expect(f.create).toHaveBeenCalledTimes(1);
});
