import {describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({context:{} as any,contexts:0}));
vi.mock('../../apps/uxp-plugin/src/host-context.js',()=>({mutationContext:async()=>{f.contexts++;return f.context;},ppro:{Constants:{TrackItemType:{CLIP:1}}}}));
import {finalizeCaptionImport} from '../../apps/uxp-plugin/src/host-caption-state.js';
describe('new caption track finalization guards',()=>{
  function fixture(){
    let muted=false;const track:any={id:7,name:'new',getTrackItems:async()=>[{},{}],isMuted:async()=>muted,createSetNameAction:(name:string)=>()=>{track.name=name;},setMute:vi.fn(async(v:boolean)=>{muted=v;return true;})};
    f.contexts=0;f.context={project:{},sequence:{getCaptionTrackCount:async()=>7,getCaptionTrack:async()=>track}};
    const args={trackIndex:6,expectedTrackId:7,expectedTrackName:'new',expectedItemCount:2,expectedMuted:false,name:'captions',muted:true};
    const execute=vi.fn((_p:any,_l:string,make:()=>any[])=>{for(const action of make())action();f.context={project:{},sequence:{getCaptionTrack:()=>{throw Error('user switched sequence');}}};return true;});
    return {track,args,execute};
  }
  it('keeps the original track owner through a user sequence switch',async()=>{
    const {track,args,execute}=fixture();const result=await finalizeCaptionImport(args,execute);
    expect(result).toMatchObject({status:'pass',after:{id:'7',name:'captions',muted:true,itemCount:2},hostResult:{projectSaved:false}});
    expect(f.contexts).toBe(1);expect(track.setMute).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('refuses a replaced or edited track before any action',async()=>{
    const {track,args,execute}=fixture();
    expect(await finalizeCaptionImport({...args,expectedTrackName:'stale'},execute)).toMatchObject({status:'fail',hostResult:{contentDispatched:false}});
    expect(execute).not.toHaveBeenCalled();expect(track.setMute).not.toHaveBeenCalled();
  });
});
