import {it,expect,vi} from 'vitest';
import {planRippleGaps} from '@premiere-uxp/contracts/ripple-plan';
import {rippleTimelineOperation} from '../../apps/mcp-server/src/ripple-operation.js';
import {prepareCaptionProof,verifyCaptionProof} from '../../apps/mcp-server/src/caption-ripple-proof.js';
import * as archive from '../../apps/mcp-server/src/premiere-sequence-archive.js';
import * as target from '../../apps/mcp-server/src/active-edit-target.js';
const frame=8475667200n,t=(n:number)=>String(BigInt(n)*frame);
const plan=planRippleGaps(String(frame),[{atTicks:t(20),frames:2}],[{id:'caption:2:0',mediaType:'caption',trackIndex:2,startTicks:t(18),endTicks:t(25)}]);
function snapshot(){return {sequenceUid:'s',tracks:[{mediaType:'caption',index:2,uid:'caption-track',style:{binaryHash:'track-style',contentSha256:'track-sha'},captionCues:[{itemObjectId:'cue',startTicks:t(18),endTicks:t(25),binaryHash:'whole-formatted-content',contentSha256:'content-sha',text:'한글 자막'}]}]} as any;}
it('proves opaque caption text/style bytes and exact saved timing without treating ObjectID as persistent identity',()=>{
  const before=snapshot(),proof=prepareCaptionProof(before,plan),after=snapshot();after.tracks[0].captionCues[0].endTicks=t(27);
  expect(verifyCaptionProof(after,proof)).toEqual([]);
  after.tracks[0].captionCues[0].contentSha256='changed-style';expect(verifyCaptionProof(after,proof)).toEqual(['Caption text/style differs: caption:2:0']);
  after.tracks[0].captionCues[0].endTicks=t(26);expect(verifyCaptionProof(after,proof)).toContain('Caption timing differs: caption:2:0');
  after.tracks[0].captionCues[0].itemObjectId='replacement';
  after.tracks[0].captionCues[0].contentSha256='content-sha';after.tracks[0].captionCues[0].endTicks=t(27);
  expect(verifyCaptionProof(after,proof)).toEqual([]);
});
it('accepts save-time ObjectID reassignment and checks all cue bytes, order and multiplicity (B1)',()=>{
  const before=snapshot();
  before.tracks[0].captionCues.unshift({...before.tracks[0].captionCues[0],itemObjectId:'old',startTicks:t(2),endTicks:t(4),text:'앞 자막',contentSha256:'first'});
  const proof=prepareCaptionProof(before,plan),after=structuredClone(before);
  after.tracks[0].captionCues[0].itemObjectId='cue';
  after.tracks[0].captionCues[1].itemObjectId='new';
  after.tracks[0].captionCues[1].endTicks=t(27);
  expect(verifyCaptionProof(after,proof)).toEqual([]);
  after.tracks[0].captionCues[0].text='손상';
  expect(verifyCaptionProof(after,proof).join(';')).toContain('text/style differs');
  after.tracks[0].captionCues.push({...after.tracks[0].captionCues[1]});
  expect(verifyCaptionProof(after,proof).join(';')).toContain('count differs');
});
it('rejects stale archive correlation instead of guessing a caption or patching the file',()=>{
  const wrong=snapshot();wrong.tracks[0].captionCues[0].startTicks=t(17);
  expect(()=>prepareCaptionProof(wrong,plan)).toThrow('BASELINE_MISMATCH');
});
it('keeps preflight failures non-dispatched and does not save or edit',async()=>{
  const mutate=vi.fn(),host={read:vi.fn(async()=>{throw Error('Target changed');}),mutate,
    mutateLocal:vi.fn(async(_command:any,_args:any,run:()=>Promise<any>)=>run())};
  const r=await rippleTimelineOperation(host as any,{},'id');
  expect(r).toMatchObject({status:'fail',result:{contentDispatched:false}});expect(mutate).not.toHaveBeenCalled();
});
it('saves around one native apply and propagates caption proof failures without replay or restore',async()=>{
  for(const fault of ['none','apply','caption']){
    const before=snapshot(),after=snapshot();after.tracks[0].captionCues[0].endTicks=t(27);
    if(fault==='caption')after.tracks[0].captionCues[0].contentSha256='changed';
    const files=vi.spyOn(archive,'snapshotPremiereSequenceArchive').mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const path=vi.spyOn(target,'localProjectPath').mockReturnValue('C:\\scratch\\any.prproj');
    const mutate=vi.fn(async(command:string)=>({status:command==='ripple_timeline'&&fault==='apply'?'unverified':'pass',errors:[],hostResult:{}}));
    const host={read:vi.fn(async()=>({projectId:'p',sequenceId:'s',sequenceName:'Any',projectPath:'C:\\scratch\\any.prproj',plan,items:[]})),mutate,
      mutateLocal:vi.fn(async(_command:any,_args:any,run:()=>Promise<any>)=>run())};
    try{
      const r=await rippleTimelineOperation(host as any,{expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'Any',expectedFrameTicks:String(frame)},'root');
      expect(r.status).toBe(fault==='none'?'pass':'unverified');
      expect(mutate.mock.calls.map(c=>c[0])).toEqual(fault==='apply'?['save_working_project','ripple_timeline']:['save_working_project','ripple_timeline','save_working_project']);
      expect((mutate.mock.calls as any)[1][2]).toBe('root:apply');
      expect((mutate.mock.calls as any)[1][1]).toMatchObject({captionBaseline:[{id:'caption:2:0',startTicks:t(18),endTicks:t(25)}]});
      expect(files).toHaveBeenCalledTimes(fault==='apply'?1:2);
    }finally{files.mockRestore();path.mockRestore();}
  }
});

it.each(['save-before','baseline','save-after','after-identity'])('preserves dispatch classification across the %s boundary',async fault=>{
  const before=snapshot(),after=snapshot();after.tracks[0].captionCues[0].endTicks=t(27);
  if(fault==='baseline')before.tracks[0].captionCues[0].startTicks=t(17);
  if(fault==='after-identity')after.sequenceUid='changed';
  const files=vi.spyOn(archive,'snapshotPremiereSequenceArchive').mockResolvedValueOnce(before).mockResolvedValueOnce(after);
  const path=vi.spyOn(target,'localProjectPath').mockReturnValue('C:\\scratch\\any.prproj');
  const mutate=vi.fn(async(_command:string,_args:unknown,id:string)=>({status:id==='root:'+fault?'fail':'pass',errors:[],hostResult:{}}));
  const host={read:vi.fn(async()=>({projectId:'p',sequenceId:'s',sequenceName:'Any',projectPath:'C:\\scratch\\any.prproj',plan,items:[]})),mutate,
    mutateLocal:vi.fn(async(_command:any,_args:any,run:()=>Promise<any>)=>run())};
  try{
    const result=await rippleTimelineOperation(host as any,{expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'Any',expectedFrameTicks:String(frame)},'root');
    const dispatched=['save-after','after-identity'].includes(fault);
    expect(result).toMatchObject({status:dispatched?'unverified':'fail',result:{contentDispatched:dispatched}});
    expect(mutate.mock.calls.map(c=>c[2])).toEqual(dispatched?['root:save-before','root:apply','root:save-after']:['root:save-before']);
    expect(files).toHaveBeenCalledTimes(fault==='save-before'?0:fault==='save-after'||fault==='baseline'?1:2);
  }finally{files.mockRestore();path.mockRestore();}
});
