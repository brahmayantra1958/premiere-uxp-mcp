import { describe, expect, it, vi } from 'vitest';
import { uxpModules } from '../helpers/uxp-modules.js';
import { lockFixture } from '../helpers/track-lock-fixture.js';

function fixture(configured=true) {
  const native=lockFixture();
  const sequence={guid:native.scope.sequenceId,name:native.scope.sequenceName,getVideoTrackCount:()=>2,getAudioTrackCount:()=>1,getVideoTrack:(i:number)=>native.tracks[i],getAudioTrack:()=>native.tracks[2]};
  const project={guid:'project-id',path:native.scope.projectPath,getActiveSequence:()=>sequence};
  const fetch=vi.fn(async(_url:string,options:any)=>({ok:true,json:async()=>native.execute(JSON.parse(options.body))}));
  const load=uxpModules({Project:{getActiveProject:()=>project}},{fetch,...(configured?{__PREMIERE_MCP_TRACK_LOCK__:{port:8095,token:'c'.repeat(64),version:'0.1.0'}}:{})});
  const {trackLocks}=load('apps/uxp-plugin/src/host-track-locks.ts');
  const args={expectedProjectId:project.guid,expectedSequenceId:sequence.guid,edits:native.request().edits};
  return {...native,sequence,project,fetch,trackLocks,args,load};
}
describe('UXP lock command and native proof',()=>{
  it('reads and edits through the real fixed helper and preserves navigation',async()=>{
    const f=fixture();
    expect(await f.trackLocks('read_track_locks',f.args,'read-12345')).toMatchObject({status:'pass',after:expect.arrayContaining([expect.objectContaining({locked:true,trackId:'1'})])});
    expect(await f.trackLocks('set_track_locks',f.args,'write-12345')).toMatchObject({status:'pass',hostResult:{unrequestedLocksPreserved:true,mutePreserved:true}});
    expect(f.fetch.mock.calls[0]![0]).toBe('http://localhost:8095/locks');
    expect(f.tracks.map(t=>t.locked)).toEqual([false,false,false]);
  });
  it('is callable through the existing serialized host dispatcher',async()=>{
    const f=fixture();const {PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts');
    expect(await new PremiereHost().dispatch({id:'host-write-123',command:'set_track_locks',args:f.args,timeoutMs:30000})).toMatchObject({status:'pass',actualTarget:{projectId:'project-id',sequenceId:f.sequence.guid}});
  });
  it('keeps unavailable configuration and invalid targets before native dispatch',async()=>{
    const noHelper=fixture(false);expect(await noHelper.trackLocks('set_track_locks',noHelper.args,'missing-123')).toMatchObject({status:'unsupported',hostResult:{contentDispatched:false}});expect(noHelper.fetch).not.toHaveBeenCalled();
    const f=fixture();expect(await f.trackLocks('set_track_locks',{...f.args,expectedSequenceId:'other'},'stale-123')).toMatchObject({status:'fail',hostResult:{contentDispatched:false}});expect(f.fetch).not.toHaveBeenCalled();
    expect(await f.trackLocks('set_track_locks',{...f.args,edits:[{...f.args.edits[0],expectedTrackId:'999'}]},'track-123')).toMatchObject({status:'fail',hostResult:{contentDispatched:false}});expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(['wrong-id','missing-track','wrong-lock','unrequested-lock','context','transport'])('refuses incorrect or uncertain success proof (%s)',async kind=>{
    const f=fixture();f.fetch.mockImplementationOnce(async(_url,options)=>{
      const result=f.execute(JSON.parse(options.body));
      if(kind==='wrong-id')result.requestId='other';
      if(kind==='missing-track')result.after.pop();
      if(kind==='wrong-lock')result.after[1].locked=true;
      if(kind==='unrequested-lock')result.after[0].locked=true;
      if(kind==='context')f.sequence.guid='other';
      if(kind==='transport')throw Error('network timeout');
      return {ok:true,json:async()=>result};
    });
    expect(await f.trackLocks('set_track_locks',f.args,'unknown-write-123')).toMatchObject({status:'unverified'});expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves a proven no-write helper refusal without quarantine/retry',async()=>{
    const f=fixture();f.fetch.mockResolvedValueOnce({ok:false,json:async()=>({error:'BUSY',contentDispatched:false})});
    expect(await f.trackLocks('set_track_locks',f.args,'busy-write-123')).toMatchObject({status:'fail',hostResult:{contentDispatched:false}});expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
