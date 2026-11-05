import {z} from 'zod/v4';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {HostExecutor} from './host-executor.js';
import type {PathPolicy} from './path-policy.js';
import {inspectCaption,captionSrtDiff,captionItemDiff} from './caption-inspection.js';
import {readCaptionSrt} from './caption-srt-source.js';
import {result,failure} from './tool-values.js';

const target={expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1),trackIndex:z.number().int().nonnegative(),expectedTrackId:z.string().optional(),expectedTrackName:z.string().optional()};
export function registerCaptionReadTools(server:McpServer,host:HostExecutor,paths:PathPolicy) {
  server.registerTool('inspect_caption_track',{
    description:'Read one existing caption track (zero-based index) without save/navigation. Live identity, mute and all cue clocks are separate from last-saved text/font/size and SHA-256. Saved archive IDs can renumber and saved text cannot guard unsaved concurrent edits; guardEligible=false. Never treats SyntheticCaption names as text.',
    inputSchema:{...target,inspectComponents:z.boolean().default(false)},annotations:{readOnlyHint:true}
  },async args=>{try{return result(await inspectCaption(host,args));}catch(e){return failure(e);}});
  server.registerTool('edit_caption_items',{
    description:'PREVIEW ONLY in this version: guarded before/after diff for existing caption text/timing, using the last-saved fingerprint and item index. conflictPolicy abort/skip controls the plan only. Does not detect unsaved user text edits; dryRun=false returns UNSUPPORTED with appliedItems=0. Native text/style-preserving mutation, add/delete/split/merge and stable live cue IDs are unavailable. Never creates a replacement track, saves or patches .prproj.',
    inputSchema:{...target,expectedFingerprint:z.string().min(1),dryRun:z.boolean().default(true),conflictPolicy:z.enum(['abort','skip']).default('abort'),
      items:z.array(z.object({itemIndex:z.number().int().nonnegative(),expectedStartTicks:z.string().regex(/^\d+$/),expectedText:z.string().optional(),expectedTextSha256:z.string().regex(/^[0-9a-f]{64}$/).optional(),
        newText:z.string().optional(),newStartTicks:z.string().regex(/^\d+$/).optional(),newEndTicks:z.string().regex(/^\d+$/).optional()}).refine(e=>e.expectedText!==undefined||e.expectedTextSha256!==undefined,'expectedText or expectedTextSha256 is required')).min(1).max(1000)},
    annotations:{readOnlyHint:true}
  },async args=>{try{return result(captionItemDiff(await inspectCaption(host,args),args));}catch(e){return failure(e);}});
  server.registerTool('apply_srt_to_caption_track',{
    description:'Preview a one-to-one numbered SRT replacement on an EXISTING caption track. Reads local SRT directly; keeps Unicode without normalization. Default text-only diff, optional frame-rounded timing. Count/time mismatch blocks. Current caption text-write/live text guard route is unavailable: dryRun=false returns UNSUPPORTED, never creates a new track or patches a project. Preview is not execution approval.',
    inputSchema:{...target,srtPath:z.string().min(1),replaceTiming:z.boolean().default(false),dryRun:z.boolean().default(true)},annotations:{readOnlyHint:true}
  },async({srtPath,replaceTiming,dryRun,...args})=>{
    try{
      const source=await readCaptionSrt(srtPath,paths),snapshot=await inspectCaption(host,args);
      const diff=captionSrtDiff(snapshot,source.cues,replaceTiming);
      return result({...diff,...(!dryRun?{status:'unsupported',dryRun:false}:{}),source:{path:source.sourcePath,sha256:source.sha256,bytes:source.bytes},fingerprint:snapshot.fingerprint,
        actualTimelineChanged:false,recovery:'No write dispatched; no lease or recovery action required.'});
    }catch(e){return failure(e);}
  });
}
