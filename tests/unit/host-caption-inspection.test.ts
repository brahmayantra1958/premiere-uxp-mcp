import {describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({context:{} as any,components:vi.fn(async()=>[])}));
vi.mock('../../apps/uxp-plugin/src/host-context.js',()=>({mutationContext:async(args:any)=>{if(args.expectedSequenceId!=='s')throw Error('SEQUENCE_PRECONDITION_FAILED');return f.context;},sequenceId:async()=> 's',ppro:{Constants:{TrackItemType:{CLIP:1}}}}));
vi.mock('../../apps/uxp-plugin/src/host-components.js',()=>({componentSnapshot:f.components}));
import {inspectCaptionTrack,inspectCaptionImportCapabilities} from '../../apps/uxp-plugin/src/host-caption-inspection.js';

describe('caption import timing preflight',()=>{
  it('reads exact timebase without requiring or creating an existing caption track',async()=>{
    f.context={project:{guid:'p'},sequence:{getTimebase:async()=>'10594584000'}};
    expect(await inspectCaptionImportCapabilities({expectedProjectId:'p',expectedSequenceId:'s'})).toEqual({
      exactTrackGuards:true,frameTicks:'10594584000',projectId:'p',sequenceId:'s',projectSaved:false,
    });
    await expect(inspectCaptionImportCapabilities({expectedSequenceId:'other'})).rejects.toThrow('SEQUENCE_PRECONDITION');
  });
  it.each(['0','-1','NaN','10.5','010',''])('rejects an unverified native timebase %j',async frameTicks=>{
    f.context={project:{guid:'p'},sequence:{getTimebase:async()=>frameTicks}};
    await expect(inspectCaptionImportCapabilities({expectedSequenceId:'s'})).rejects.toThrow('CAPTION_IMPORT_TIMEBASE_UNVERIFIED');
  });
});
describe('live caption inspector',()=>{
  it('reads all clocks without presenting names or archive IDs as live text/identity',async()=>{
    const getName=vi.fn(),getItems=vi.fn(async()=>[{getStartTime:async()=>({ticks:'0'}),getEndTime:async()=>({ticks:'100'}),getName,createSetEndAction:()=>{throw Error('no write');}}]);
    f.context={project:{guid:'p',path:'C:/p.prproj'},sequence:{name:'s',getCaptionTrackCount:async()=>1,getTimebase:async()=> '10',getCaptionTrack:async()=>({id:7,name:'captions',getTrackItems:getItems,isMuted:async()=>false})}};
    const result=await inspectCaptionTrack({expectedProjectId:'p',expectedSequenceId:'s',trackIndex:0});
    expect(result.track.itemCount).toBe(1);expect(result.items[0]).toMatchObject({text:null,id:null,startTicks:'0',endTicks:'100'});
    expect(getName).not.toHaveBeenCalled();expect(result.contentDispatched).toBe(false);
    await expect(inspectCaptionTrack({expectedSequenceId:'other',trackIndex:0})).rejects.toThrow('SEQUENCE_PRECONDITION');
    await expect(inspectCaptionTrack({expectedSequenceId:'s',trackIndex:0,expectedTrackId:'8'})).rejects.toThrow('TRACK_ID_CHANGED');
  });
  it('counts real caption selection across tracks even when public selection contains only AV',async()=>{
    const item=(selected:boolean)=>({getStartTime:async()=>({ticks:'0'}),getEndTime:async()=>({ticks:'100'}),getIsSelected:async()=>selected});
    const tracks=[{id:7,name:'captions',getTrackItems:async()=>[item(true)],isMuted:async()=>false},{id:8,name:'other captions',getTrackItems:async()=>[item(false),item(true)],isMuted:async()=>false}];
    f.context={project:{guid:'p',path:'C:/p.prproj'},sequence:{name:'s',getCaptionTrackCount:async()=>2,getTimebase:async()=> '10',getCaptionTrack:async(i:number)=>tracks[i],getSelection:async()=>({getTrackItems:async()=>[{av:true}]})}};
    const result=await inspectCaptionTrack({expectedProjectId:'p',expectedSequenceId:'s',trackIndex:0,inspectSelection:true});
    expect(result.items[0].selected).toBe(true);
    expect(result.selection).toEqual({selectedCaptions:2,selectedOtherItems:1,scannedCaptions:3});
    expect(result.contentDispatched).toBe(false);
  });
  it('bounds the cross-track selection scan before reading an oversized other track',async()=>{
    const inspectOther=vi.fn();
    const tracks=[{id:7,name:'captions',getTrackItems:async()=>[],isMuted:async()=>false},{getTrackItems:async()=>Array(10001).fill({getIsSelected:inspectOther})}];
    f.context={project:{guid:'p',path:'C:/p.prproj'},sequence:{name:'s',getCaptionTrackCount:async()=>2,getTimebase:async()=> '10',getCaptionTrack:async(i:number)=>tracks[i]}};
    await expect(inspectCaptionTrack({expectedProjectId:'p',expectedSequenceId:'s',trackIndex:0,inspectSelection:true})).rejects.toThrow('CAPTION_SELECTION_SCAN_LIMIT');
    expect(inspectOther).not.toHaveBeenCalled();
  });
});
