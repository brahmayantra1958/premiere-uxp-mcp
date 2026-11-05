import {randomUUID} from 'node:crypto';
import {z} from 'zod/v4';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {HostExecutor} from './host-executor.js';
import type {PathPolicy} from './path-policy.js';
import {runCepCaptionHelper,assertCaptionHelperReady} from './cep-caption-helper.js';
import {readActiveEditTarget} from './active-edit-target.js';
import {readCaptionSrt} from './caption-srt-source.js';
import {operationId,seconds,captionPlacementIndex} from './tool-inputs.js';
import {result,failure,comparablePath} from './tool-values.js';
import {captionFrameTicks,planCaptionImportTiming,verifyCaptionImportTiming} from './caption-import-timing.js';

function importFrameTicks(capability:Record<string,any>,args:Record<string,unknown>):string {
  if(capability.exactTrackGuards!==true)throw Error('CAPTION_IMPORT_PANEL_UPDATE_REQUIRED');
  if(capability.frameTicks===undefined)throw Error('CAPTION_IMPORT_TIMING_CAPABILITY_REQUIRED: load a panel exposing exact caption-import frameTicks; no content dispatched');
  if(capability.projectId!==args.expectedProjectId||capability.sequenceId!==args.expectedSequenceId)throw Error('CAPTION_IMPORT_TIMING_TARGET_CHANGED');
  return captionFrameTicks(capability.frameTicks);
}

/** Compact proof projection: never return repeated project/effect snapshots in
 * a caption receipt. The old ~8 MB receipt exceeded the 10 MiB stdio limit once
 * duplicated as text + structuredContent. Detailed host reads stay in audit. */
export function captionPreservation(sequence:Record<string,any>) {
  if(sequence.itemsTruncated)throw Error('CAPTION_AV_PROOF_TRUNCATED');
  return {id:sequence.id,videoTracks:sequence.videoTracks,audioTracks:sequence.audioTracks,
    tracks:sequence.captionTrackStates,
    av:sequence.items.map((i:any)=>[i.id,i.projectItemId,i.mediaType,i.trackIndex,i.start.ticks,i.end.ticks,i.inPoint?.ticks,i.outPoint?.ticks,i.speed,i.reversed,i.disabled])};
}

async function captionSourceItem(host:HostExecutor,args:Record<string,unknown>,sourcePath:string) {
  const matches:Record<string,any>[]=[],seenCursors=new Set<string>();
  let cursor:string|undefined;
  for(;;){
    const page=await host.read('query_media',{expectedProjectId:args.expectedProjectId,expectedSequenceId:args.expectedSequenceId,limit:100,...(cursor?{cursor}:{})}) as Record<string,any>;
    if(!Array.isArray(page.items)||!page.page||page.page.scanTruncated)throw Error('CAPTION_SOURCE_READ_INCOMPLETE');
    matches.push(...page.items.filter((item:any)=>item.path&&comparablePath(item.path)===comparablePath(sourcePath)));
    if(!page.page.hasMore)break;
    const next=page.page.nextCursor;
    if(typeof next!=='string'||!next||seenCursors.has(next))throw Error('CAPTION_SOURCE_CURSOR_UNVERIFIED');
    seenCursors.add(next);cursor=next;
  }
  if(matches.length!==1)throw Error(matches.length?'CAPTION_SOURCE_ITEM_AMBIGUOUS':'CAPTION_SOURCE_ITEM_NOT_FOUND');
  return matches[0]!;
}
export function registerCaptionTool(server:McpServer,host:HostExecutor,paths:PathPolicy):void {
  server.registerTool('import_caption_track',{
    description:'Create one NEW native caption track from unchanged SRT bytes. Never replaces an existing track; overwrite is refused. Verify every live cue against nearest sequence-frame rounding of SRT ticks, with exact half-frame ties to the later frame. This is the tool expectation, not an Adobe rounding guarantee. Optional expectedTimingPlan supplies exact expected ticks for verification only; it does not retime, compensate or rewrite SRT. Mismatch leaves the created track and its proof UNVERIFIED; inspect before any new work, never replay. Timing, track metadata and AV preservation are verified separately from unavailable live caption text/style proof. No automatic save. Requires exact frameTicks import capability and no-save caption helper 0.2.3+.',
    inputSchema:{expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1),expectedSequenceName:z.string().min(1),
      srtPath:z.string().min(1),timeSeconds:seconds.default(0),trackName:z.string().min(1).max(100).default('Captions'),muted:z.boolean().default(false),
      expectedTimingPlan:z.object({frameTicks:z.string().max(30).regex(/^[1-9]\d*$/),cues:z.array(z.object({startTicks:z.string().max(30).regex(/^(0|[1-9]\d*)$/),endTicks:z.string().max(30).regex(/^[1-9]\d*$/)}).strict()).min(1).max(10000)}).strict().optional().describe('Verification only: expected sequence frameTicks and one frame-aligned start/end tick pair per numbered SRT cue, in the same order. Never changes source bytes or native placement.'),
      binId:z.string().min(1).optional(),placementMode:z.enum(['insert','overwrite']).default('insert'),videoTrackIndex:captionPlacementIndex.default(0),audioTrackIndex:captionPlacementIndex.default(0),operationId}
  },async({operationId:requestedId,...args})=>{
    try{
      if(args.placementMode!=='insert'||args.videoTrackIndex!==0||args.audioTrackIndex!==0)throw Error('CEP_CAPTION_PLACEMENT_UNSUPPORTED: createCaptionTrack adds a new caption track; existing-track text replacement is unavailable. No command dispatched.');
      if(args.timeSeconds!==0)throw Error('CEP_CAPTION_START_OFFSET_UNSUPPORTED: no command dispatched');
      const id=requestedId??randomUUID(),target=await readActiveEditTarget(host,args);
      const native=await host.read('inspect_caption_import_capabilities',args).catch(e=>{
        if(/UNSUPPORTED_COMMAND/.test(String(e)))throw Error('CAPTION_IMPORT_PANEL_UPDATE_REQUIRED: load a current panel exposing exact caption-import frameTicks; no content dispatched');
        throw e;
      }) as Record<string,any>;
      const frameTicks=importFrameTicks(native,args);
      await assertCaptionHelperReady();
      const source=await readCaptionSrt(args.srtPath,paths,true);
      const timingPlan=planCaptionImportTiming(source.cues,frameTicks,args.expectedTimingPlan);
      const commandArgs={...args,sourceSha256:source.sha256};
      return result(await host.mutateLocal('import_caption_track',commandArgs,async()=>{
        let dispatched=false;
        const evidence:Record<string,any>={route:'cep_legacy_helper',projectId:args.expectedProjectId,sequenceId:args.expectedSequenceId,
          source:{path:source.sourcePath,sha256:source.sha256,scratchPath:source.scratchPath},projectSaved:false,helperOperationId:id,
          textVerification:{status:'unverified',reason:'live_caption_text_and_style_unavailable'}};
        try{
          await readActiveEditTarget(host,args);
          if(args.binId){
            const parent=await host.read('query_media',{expectedProjectId:args.expectedProjectId,expectedSequenceId:args.expectedSequenceId,ids:[args.binId],limit:1}) as Record<string,any>;
            if(parent.page?.scanTruncated||parent.page?.hasMore||parent.items?.length!==1||parent.items[0].id!==args.binId||parent.items[0].kind!=='folder')throw Error('CAPTION_PARENT_BIN_NOT_FOUND: inspect query_media and use the exact folder ID');
          }
          const before=await host.read('inspect_sequence',args) as Record<string,any>;
          const proof=captionPreservation(before);
          if(before.captionTracks>=32)throw Error('CAPTION_TRACK_LIMIT');
          const currentFrameTicks=importFrameTicks(await host.read('inspect_caption_import_capabilities',args) as Record<string,any>,args);
          if(currentFrameTicks!==timingPlan.frameTicks)throw Error('CAPTION_IMPORT_TIMEBASE_CHANGED_BEFORE_DISPATCH');
          // Check readiness again before the one external dispatch.
          await assertCaptionHelperReady();
          dispatched=true;
          const helper=await runCepCaptionHelper({id,projectPath:target.projectPath,sequenceName:target.sequenceName,sequenceId:target.sequenceId,
            srtPath:source.scratchPath!,trackName:args.trackName,muted:args.muted,expectedCaptionTracksBefore:before.captionTracks});
          evidence.helperStatus=helper.status;
          if(helper.status!=='pass')throw Error('CAPTION_HELPER_RESULT_UNVERIFIED: '+JSON.stringify(helper.outcome));
          const created=await host.read('inspect_sequence',args) as Record<string,any>,index=before.captionTracks;
          evidence.creation={expectedTrackIndex:index,captionTrackCountBefore:index,captionTrackCountAfter:created.captionTracks,
            observedTrack:created.captionTrackStates[index]??null,verified:false};
          if(created.captionTracks!==index+1||created.captionTrackStates[index]?.itemCount!==source.cues.length)throw Error('CAPTION_CREATED_TRACK_UNVERIFIED');
          evidence.creation.verified=true;
          const createdTrack=created.captionTrackStates[index];
          evidence.track=createdTrack;
          if(args.binId){
            const item=await captionSourceItem(host,args,source.scratchPath!);
            if(item.parentId!==args.binId){
              const moved=await host.mutate('move_project_items',{expectedProjectId:args.expectedProjectId,expectedSequenceId:args.expectedSequenceId,projectItemIds:[item.id],targetBinId:args.binId},id+':bin');
              if(moved.status!=='pass')throw Error('CAPTION_BIN_MOVE_UNVERIFIED');
            }
          }
          evidence.trackStateOperationId=id+':track-state';
          const trackState=await host.mutate('finalize_caption_import',{expectedProjectId:args.expectedProjectId,expectedSequenceId:args.expectedSequenceId,
            trackIndex:index,expectedTrackId:createdTrack.id,expectedTrackName:createdTrack.name,expectedItemCount:createdTrack.itemCount,expectedMuted:createdTrack.muted,
            name:args.trackName,muted:args.muted},id+':track-state');
          if(trackState.status!=='pass')throw Error('CAPTION_TRACK_STATE_UNVERIFIED: '+trackState.errors.join('; '));
          const timing=await host.read('inspect_caption_track',{expectedProjectId:args.expectedProjectId,expectedSequenceId:args.expectedSequenceId,expectedSequenceName:args.expectedSequenceName,
            trackIndex:index,expectedTrackId:String(createdTrack.id),expectedTrackName:args.trackName}) as Record<string,any>;
          evidence.timingReadbackTarget={projectId:timing.projectId,sequenceId:timing.sequenceId,track:timing.track};
          const timingVerification=verifyCaptionImportTiming(timingPlan,timing);
          if(timing.projectId!==args.expectedProjectId||timing.sequenceId!==args.expectedSequenceId||timing.sequenceName!==args.expectedSequenceName
            ||timing.track?.index!==index||String(timing.track?.id)!==String(createdTrack.id)||timing.track?.name!==args.trackName
            ||timing.track?.muted!==args.muted||timing.track?.itemCount!==source.cues.length||timing.captionTrackCount!==index+1){
            timingVerification.status='unverified';timingVerification.errors.push('CAPTION_TIMING_TRACK_IDENTITY_UNVERIFIED');
          }
          evidence.timingVerification=timingVerification;
          const after=await host.read('inspect_sequence',args) as Record<string,any>,afterProof=captionPreservation(after);
          const track=after.captionTrackStates[index];
          const preserved=JSON.stringify(proof.av)===JSON.stringify(afterProof.av)&&proof.id===afterProof.id&&proof.videoTracks===afterProof.videoTracks&&proof.audioTracks===afterProof.audioTracks
            &&JSON.stringify(proof.tracks)===JSON.stringify(afterProof.tracks.slice(0,index));
          evidence.preservation={avItemCount:proof.av.length,avUnchanged:JSON.stringify(proof.av)===JSON.stringify(afterProof.av),otherCaptionTrackMetadataUnchanged:JSON.stringify(proof.tracks)===JSON.stringify(afterProof.tracks.slice(0,index))};
          if(!preserved||after.captionTracks!==index+1||!track||String(track.id)!==String(createdTrack.id)||track.name!==args.trackName||track.muted!==args.muted||track.itemCount!==source.cues.length)throw Error('CAPTION_IMPORT_PRESERVATION_UNVERIFIED');
          evidence.track=track;
          return {status:timingVerification.status,result:{...evidence,contentDispatched:true,
            ...(timingVerification.status==='unverified'?{recovery:'Created track remains in place. Inspect its exact identity and timing deltas; no automatic retiming, replacement, retry or save was performed.'}:{})},errors:timingVerification.errors};
        }catch(e){return {status:dispatched?'unverified':'fail',result:{...evidence,contentDispatched:dispatched,
          ...(dispatched?{recovery:'Import may have created the reported track. Inspect existing track/timing evidence before new work; never replay an unknown import.'}:{})},errors:[String(e)]};}
      },id));
    }catch(e){return failure(e);}
  });
}
