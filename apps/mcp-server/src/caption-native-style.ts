import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {z} from 'zod/v4';
import type {HostExecutor} from './host-executor.js';
import {runtimePaths} from './config.js';

export const captionStyleTargetSchema=z.object({expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1),expectedSequenceName:z.string().min(1),
  trackIndex:z.number().int().min(0).max(99),expectedTrackId:z.string().min(1),expectedTrackName:z.string().min(1).max(500),
  itemIndex:z.number().int().nonnegative(),expectedStartTicks:z.string().regex(/^\d+$/),expectedEndTicks:z.string().regex(/^\d+$/)});
export type CaptionStyleTarget=z.infer<typeof captionStyleTargetSchema>;
export type CaptionFontEdit=CaptionStyleTarget&{expectedFontFamily:string;expectedFontStyle:string;fontStyle:string;dryRun:boolean};
type Native=(request:Record<string,unknown>)=>Promise<Record<string,any>>;
const executable=fileURLToPath(new URL('../native/windows/bin/PremiereCaptionStyleBridge.exe',import.meta.url));

/** Never fall back to archive text, a name-only match, or the public selection
 * collection which omits captions. One actual caption and no AV selection. */
export function assertCaptionStyleTarget(snapshot:Record<string,any>,args:CaptionStyleTarget){
  if(snapshot.projectId!==args.expectedProjectId||snapshot.sequenceId!==args.expectedSequenceId||snapshot.sequenceName!==args.expectedSequenceName||
    snapshot.track?.index!==args.trackIndex||snapshot.track?.id!==args.expectedTrackId||snapshot.track?.name!==args.expectedTrackName)throw Error('CAPTION_STYLE_TARGET_CHANGED');
  const item=snapshot.items?.[args.itemIndex];
  if(snapshot.selection?.selectedCaptions!==1||snapshot.selection?.selectedOtherItems!==0||item?.selected!==true||
    item.startTicks!==args.expectedStartTicks||item.endTicks!==args.expectedEndTicks)throw Error('CAPTION_STYLE_EXACT_SELECTION_REQUIRED');
  return {sequenceName:args.expectedSequenceName,trackIndex:args.trackIndex,trackName:args.expectedTrackName,itemIndex:args.itemIndex,itemCount:snapshot.items.length};
}

export async function runCaptionStyleNative(request:Record<string,unknown>):Promise<Record<string,any>>{
  if (process.platform !== 'win32') return { status: 'unsupported', reason: 'This native adapter requires Windows', contentDispatched: false };
  const instance=JSON.parse(await readFile(path.join(runtimePaths.runtimeDirectory,'native-visual-instance.json'),'utf8'));
  if(instance.connected!==true||!Number.isSafeInteger(instance.premierePid)||instance.premierePid<=0)throw Error('CAPTION_PREMIERE_PID_UNAVAILABLE');
  return new Promise(resolve=>execFile(executable,[Buffer.from(JSON.stringify({...request,protocol:1,pid:instance.premierePid})).toString('base64')],
    {windowsHide:true,timeout:6000,maxBuffer:65536,encoding:'utf8'},(error,stdout)=>{
      try{
        const r=JSON.parse(stdout);
        if(r.protocol!==1||r.route!=='windows_msaa_caption_font_style'||typeof r.contentDispatched!=='boolean')throw Error('CAPTION_NATIVE_PROTOCOL');
        if(r.status==='fail'&&r.contentDispatched===false){resolve(r);return;}
        if(error||r.premierePid!==instance.premierePid||r.status!=='pass'||['sequenceName','trackIndex','trackName','itemIndex','itemCount'].some(k=>r[k]!==request[k]))throw Error('CAPTION_NATIVE_SCOPE');
        resolve(r);
      }catch{resolve({status:'unverified',contentDispatched:request.operation==='set_font_style',reason:'Native caption response unavailable; inspect before retry.'});}
    }));
}

export async function readSelectedCaptionFont(host:HostExecutor,args:CaptionStyleTarget,native:Native=runCaptionStyleNative){
  const before=await host.read('inspect_caption_track',{...args,inspectSelection:true}) as Record<string,any>;
  const target=assertCaptionStyleTarget(before,args),observed=await native({operation:'read',...target});
  if(observed.status!=='pass')throw Error(observed.reason??'CAPTION_FONT_OBSERVATION_FAILED');
  const after=await host.read('inspect_caption_track',{...args,inspectSelection:true}) as Record<string,any>;
  assertCaptionStyleTarget(after,args);
  return {status:'pass',target:args,font:observed.after,source:'live_native_properties',textRead:false,
    capabilities:{fontStyleWrite:true,fontFamilyWrite:false,fontSizeWrite:false,textWrite:false},contentDispatched:false};
}

/** A durable, deduplicated operation around a single semantic font choice. It
 * never selects/reveals a caption, saves, replays a timeout or restores old state. */
export async function setSelectedCaptionFontStyle(host:HostExecutor,args:CaptionFontEdit,operationId?:string,native:Native=runCaptionStyleNative){
  const execute=async()=>{
    let contentDispatched=false;
    try{
      const baseline=await readSelectedCaptionFont(host,args,native);
      if(baseline.font.fontFamily!==args.expectedFontFamily||baseline.font.fontStyle!==args.expectedFontStyle)throw Error('CAPTION_FONT_CHANGED');
      if(!baseline.font.fontStyleChoices.includes(args.fontStyle))throw Error('CAPTION_FONT_STYLE_UNAVAILABLE');
      if(args.dryRun)return {status:'pass' as const,result:{dryRun:true,contentDispatched:false,before:baseline.font,after:{...baseline.font,fontStyle:args.fontStyle}}};
      const snapshot=await host.read('inspect_caption_track',{...args,inspectSelection:true}) as Record<string,any>;
      const target=assertCaptionStyleTarget(snapshot,args);
      contentDispatched=args.fontStyle!==args.expectedFontStyle;
      const applied=await native({operation:'set_font_style',...target,expectedFontFamily:args.expectedFontFamily,expectedFontStyle:args.expectedFontStyle,fontStyle:args.fontStyle});
      if(applied.status==='fail'&&applied.contentDispatched===false)contentDispatched=false;
      if(applied.status!=='pass')throw Error(applied.reason??'CAPTION_FONT_APPLY_UNVERIFIED');
      const after=await readSelectedCaptionFont(host,args,native);
      if(after.font.fontStyle!==args.fontStyle||after.font.fontFamily!==args.expectedFontFamily)throw Error('CAPTION_FONT_READBACK_MISMATCH');
      return {status:'pass' as const,result:{contentDispatched,before:baseline.font,after:after.font,target:args,
        proof:'fresh_native_properties_and_public_caption_identity',projectSaved:false,textPreservation:'not_independently_readable'}};
    }catch(e){return {status:contentDispatched?'unverified' as const:'fail' as const,result:{contentDispatched},errors:[String(e)]};}
  };
  if(args.dryRun)return execute();
  return host.mutateLocal('set_selected_caption_font_style',args,execute,operationId);
}
