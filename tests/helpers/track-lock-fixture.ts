import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';
const require = createRequire(import.meta.url);
export const lockService = require('../../apps/cep-track-lock/service.cjs');
export function lockFixture(projectPath = 'C:\\work\\edit.prproj') {
  const scope = { projectPath, sequenceId: 'seq-123', sequenceName: 'Current editing sequence' };
  const tracks = [false, true, false].map((locked, i) => ({ id:i === 2 ? 0 : i, name:['Video 1','Video 2','Audio 1'][i]!, locked, targeted:true, muted:false,
    isLocked(){return this.locked ? 1 : 0;}, isTargeted(){return this.targeted;}, isMuted(){return this.muted;},
    setLocked:vi.fn(function(this:any,value:number){this.locked=Boolean(value);if(value)this.targeted=false;}) }));
  const project:any = {path:scope.projectPath,activeSequence:{sequenceID:scope.sequenceId,name:scope.sequenceName,videoTracks:{0:tracks[0],1:tracks[1],numTracks:2},audioTracks:{0:tracks[2],numTracks:1}}};
  const context:any={app:{project},JSON:undefined};
  runInNewContext(readFileSync('apps/cep-track-lock/host/locks.jsx','utf8'),context);
  const request=(overrides:any={})=>({version:1,id:'lock-test-123',operation:'set_track_locks',expiresAt:Date.now()+15000,...scope,tracks:{video:tracks.slice(0,2).map(t=>({id:String(t.id),name:t.name})),audio:[{id:'0',name:tracks[2]!.name}]},edits:[{mediaType:'video',trackIndex:1,expectedTrackId:'1',expectedTrackName:'Video 2',locked:false,expectedLocked:true}],...overrides});
  const execute=(value:any)=>JSON.parse(runInNewContext(lockService.expression(value),context));
  return {scope,tracks,project,request,execute};
}
