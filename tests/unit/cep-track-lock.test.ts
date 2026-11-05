import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { lockFixture, lockService } from '../helpers/track-lock-fixture.js';

describe('bounded native track locking',()=>{
  it.each(['C:\\work\\edit.prproj','/Users/someone/Any project/edit.prproj'])('locks/unlocks named targets and leaves other locks/content alone (%s)',projectPath=>{
    const f=lockFixture(projectPath),request=f.request(),unlocked=f.execute(request);
    expect(unlocked.status).toBe('pass');expect(unlocked.after.map((r:any)=>r.locked)).toEqual([false,false,false]);
    expect(f.tracks[1]!.setLocked).toHaveBeenCalledExactlyOnceWith(0);expect(f.tracks[0]!.setLocked).not.toHaveBeenCalled();expect(f.tracks[2]!.setLocked).not.toHaveBeenCalled();
    const locked=f.execute(f.request({edits:[{...request.edits[0],locked:true,expectedLocked:false}]}));
    expect(locked.after[1]).toMatchObject({locked:true,targeted:false,muted:false});
    expect(f.execute(f.request({edits:[{...request.edits[0],locked:true}]})).changed).toEqual([]);expect(f.tracks[1]!.setLocked).toHaveBeenCalledTimes(2);
  });
  it('reads without setters and preserves an untargeted track',()=>{
    const f=lockFixture();f.tracks[0]!.targeted=false;
    expect(f.execute(f.request({operation:'read_track_locks',edits:[]})).after[0]).toMatchObject({locked:false,targeted:false});
    f.tracks.forEach(t=>expect(t.setLocked).not.toHaveBeenCalled());
  });
  it('preflights an entire mixed batch before writing and honors expectedLocked',()=>{
    const f=lockFixture(),request=f.request();
    const failed=f.execute(f.request({edits:[...request.edits,{mediaType:'audio',trackIndex:0,expectedTrackId:'0',expectedTrackName:'Audio 1',locked:true,expectedLocked:true}]}));
    expect(failed).toMatchObject({status:'fail',contentDispatched:false,error:expect.stringContaining('LOCK_PRECONDITION')});f.tracks.forEach(t=>expect(t.setLocked).not.toHaveBeenCalled());
    const result=f.execute(f.request({edits:[...request.edits,{mediaType:'audio',trackIndex:0,expectedTrackId:'0',expectedTrackName:'Audio 1',locked:true}]}));
    expect(result.after.map((r:any)=>r.locked)).toEqual([false,false,true]);
  });
  it.each(['project','sequence','trackId','trackName','trackCount','api','unreadable'])('rejects stale or unsupported native state before writes (%s)',kind=>{
    const f=lockFixture(),request=f.request();
    if(kind==='project')f.project.path='C:\\different.prproj';
    if(kind==='sequence')f.project.activeSequence.sequenceID='different';
    if(kind==='trackId')f.tracks[1]!.id=999;
    if(kind==='trackName')f.tracks[1]!.name='Renamed';
    if(kind==='trackCount')f.project.activeSequence.videoTracks.numTracks=1;
    if(kind==='api')(f.tracks[1] as any).isLocked=undefined;
    if(kind==='unreadable')(f.tracks[1] as any).isLocked=()=>undefined;
    expect(f.execute(request)).toMatchObject({status:'fail',contentDispatched:false});f.tracks.forEach(t=>expect(t.setLocked).not.toHaveBeenCalled());
  });
  it.each(['silent','unrequested','context'])('does not report PASS or replay a failed native write (%s)',kind=>{
    const f=lockFixture();f.tracks[1]!.setLocked.mockImplementationOnce(()=>{
      if(kind==='unrequested'){f.tracks[1]!.locked=false;f.tracks[0]!.locked=true;}
      if(kind==='context')f.project.activeSequence.sequenceID='different';
    });
    expect(f.execute(f.request())).toMatchObject({status:'unverified',contentDispatched:true});expect(f.tracks[1]!.setLocked).toHaveBeenCalledTimes(1);
  });
  it('accepts strings as data, rejects arbitrary script input, captions, duplicate edits and stale requests',()=>{
    const f=lockFixture(),request=f.request();const name='quoted"\\);app.project.save();//\u2028';f.tracks[1]!.name=name;
    expect(f.execute(f.request({edits:[{...request.edits[0],expectedTrackName:name}]})).status).toBe('pass');
    for(const change of [{script:'app.project.save()'},{operation:'eval'},{expiresAt:0},{edits:[request.edits[0],request.edits[0]]},{edits:[{...request.edits[0],mediaType:'caption'}]}])expect(()=>lockService.validate(f.request(change))).toThrow();
  });
});

describe('authenticated lock transport',()=>{
  it('requires token/host, deduplicates IDs and preserves an uncertain receipt after a fresh read',async()=>{
    const f=lockFixture(),records:any[]=[];let unknown=false;
    const evaluate=vi.fn((script:string,callback:(s:string)=>void)=>{const request=JSON.parse(script.slice('BrahmaYantraTrackLocks.execute('.length,-1));callback(JSON.stringify(unknown?{status:'unverified',error:'fixture'}:f.execute(request)));});
    const config={port:0,token:'a'.repeat(64)},server:Server=lockService.createLockServer(config,evaluate,(r:any)=>records.push(r));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));config.port=(server.address() as any).port;
    const post=(request:any,headers:any={authorization:`Bearer ${config.token}`})=>fetch(`http://127.0.0.1:${config.port}/locks`,{method:'POST',headers,body:JSON.stringify(request)});
    try{
      expect((await post(f.request(),{})).status).toBe(401);
      const wrongHost=await new Promise<number|undefined>((resolve,reject)=>{
        const request=httpRequest({hostname:'127.0.0.1',port:config.port,path:'/locks',method:'POST',headers:{authorization:`Bearer ${config.token}`,host:'attacker.invalid'}},response=>{response.resume();resolve(response.statusCode);});
        request.on('error',reject);request.end(JSON.stringify(f.request()));
      });
      expect(wrongHost).toBe(403);
      const request=f.request();expect((await (await post(request)).json()).status).toBe('pass');await post(request);expect(evaluate).toHaveBeenCalledTimes(1);
      expect((await post({...request,edits:[]})).status).toBe(400);
      expect((await post({...request,edits:[{...request.edits[0],locked:true}]})).status).toBe(409);
      unknown=true;const uncertain=f.request({id:'unknown-123'});expect((await (await post(uncertain)).json()).status).toBe('unverified');
      expect((await post(f.request({id:'another-123'}))).status).toBe(409);
      unknown=false;expect((await (await post(f.request({id:'fresh-read-123',operation:'read_track_locks',edits:[]}))).json()).status).toBe('pass');
      expect(records.some(r=>r.reconciled)).toBe(true);expect((await (await post(uncertain)).json()).status).toBe('unverified');
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('cannot clear quarantine while an older timed-out callback may still write',async()=>{
    const f=lockFixture(),callbacks:Array<(s:string)=>void>=[],deadlines:Array<()=>void>=[],records:any[]=[];
    const realTimer=globalThis.setTimeout;
    const timer=vi.spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,ms:any,...rest:any[])=>{if(ms===12000){deadlines.push(fn);return realTimer(fn,60000,...rest);}return realTimer(fn,ms,...rest);}) as any);
    const config={port:0,token:'b'.repeat(64)},server:Server=lockService.createLockServer(config,(script:string,callback:(s:string)=>void)=>{
      callbacks.push(callback);
      if(callbacks.length>1){const request=JSON.parse(script.slice('BrahmaYantraTrackLocks.execute('.length,-1));callback(JSON.stringify(f.execute(request)));}
    },(r:any)=>records.push(r));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));config.port=(server.address() as any).port;
    const post=(request:any)=>fetch(`http://127.0.0.1:${config.port}/locks`,{method:'POST',headers:{authorization:`Bearer ${config.token}`},body:JSON.stringify(request)});
    try{
      const pending=post(f.request());await vi.waitFor(()=>expect(callbacks).toHaveLength(1));deadlines[0]!();expect((await (await pending).json()).status).toBe('unverified');
      await post(f.request({id:'read-before-123',operation:'read_track_locks',edits:[]}));expect(records.some(r=>r.reconciled)).toBe(false);
      callbacks[0]!(JSON.stringify({status:'fail',contentDispatched:false}));
      await post(f.request({id:'read-after-123',operation:'read_track_locks',edits:[]}));expect(records.some(r=>r.reconciled)).toBe(true);
    }finally{timer.mockRestore();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
