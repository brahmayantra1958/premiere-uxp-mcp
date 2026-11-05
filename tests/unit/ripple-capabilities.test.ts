import {it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';
it('reports caption methods and readable clocks without creating actions or changing navigation',async()=>{
  const move=vi.fn(),position=vi.fn(),sample={getStartTime:()=>({ticks:'100',seconds:1}),getEndTime:()=>({ticks:'200',seconds:2}),getName:()=> 'caption',createMoveAction:move};
  const sequence={guid:'s',getTimebase:()=> '8475667200',getCaptionTrackCount:()=>1,getCaptionTrack:()=>({id:7,name:'caption track',getTrackItems:()=>[sample]}),getVideoTrackCount:()=>1,getAudioTrackCount:()=>1,setPlayerPosition:position};
  const load=uxpModules({Project:{getActiveProject:()=>({guid:'p',getActiveSequence:()=>sequence})},Constants:{TrackItemType:{CLIP:1}},SequenceEditor:{getEditor:()=>({createInsertProjectItemAction:vi.fn(),createRemoveItemsAction:vi.fn()})}});
  const inspect=load('apps/uxp-plugin/src/host-ripple.ts').inspectRippleCapabilities;
  const result=await inspect({expectedProjectId:'p',expectedSequenceId:'s'});
  expect(result).toMatchObject({status:'pass',contentDispatched:false,captions:[{itemCount:1,samples:[{name:'caption',start:{ticks:'100'},methods:{createMoveAction:true,getComponentChain:false}}]}]});
  expect(move).not.toHaveBeenCalled();expect(position).not.toHaveBeenCalled();
  await expect(inspect({expectedProjectId:'other',expectedSequenceId:'s'})).rejects.toThrow('RIPPLE_TARGET_CHANGED');
});
