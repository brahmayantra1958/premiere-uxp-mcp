import {z} from 'zod/v4';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {HostExecutor} from './host-executor.js';
import {captionStyleTargetSchema,readSelectedCaptionFont,setSelectedCaptionFontStyle} from './caption-native-style.js';
import {result,failure} from './tool-values.js';

export function registerCaptionNativeStyleTools(server:McpServer,host:HostExecutor,edit:boolean){
  server.registerTool('inspect_selected_caption_font',{
    description:'Read the live font family, face and available faces of exactly one already-selected existing caption from native Properties. Requires exact project/sequence/track/cue clocks, no other selection, Premiere 26.5 Korean Properties visible. Does not select/focus/save; never reads saved text as live text.',
    inputSchema:captionStyleTargetSchema.shape,annotations:{readOnlyHint:true}},async args=>{try{return result(await readSelectedCaptionFont(host,args));}catch(e){return failure(e);}});
  if(edit)server.registerTool('set_selected_caption_font_style',{
    description:'Change only the font face (e.g. Bold to SemiBold) of one already-selected existing caption, through native semantic combo selection. Exact live identity, single selection, expected family/face and native readback required. dryRun defaults true. No synthetic input, target navigation, save, new caption track, text/size/color editing or track-wide style update. Native timeouts stay UNVERIFIED; never replay with a new operationId.',
    inputSchema:{...captionStyleTargetSchema.shape,expectedFontFamily:z.string().min(1).max(200),expectedFontStyle:z.string().min(1).max(200),fontStyle:z.string().min(1).max(200),dryRun:z.boolean().default(true),operationId:z.string().min(1).max(200).optional()},
    annotations:{readOnlyHint:false,destructiveHint:false}},async({operationId,...args})=>{try{return result(await setSelectedCaptionFontStyle(host,args,operationId));}catch(e){return failure(e);}});
}
