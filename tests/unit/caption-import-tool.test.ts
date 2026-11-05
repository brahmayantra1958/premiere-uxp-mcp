import {describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({helper:vi.fn(async()=>({status:'pass',outcome:{saved:false}})),ready:vi.fn(async()=>{})}));
vi.mock('../../apps/mcp-server/src/cep-caption-helper.js',()=>({runCepCaptionHelper:f.helper,assertCaptionHelperReady:f.ready}));
vi.mock('../../apps/mcp-server/src/active-edit-target.js',()=>({readActiveEditTarget:async()=>({projectPath:'C:/project.prproj',sequenceName:'s',sequenceId:'sid'})}));
vi.mock('../../apps/mcp-server/src/caption-srt-source.js',()=>({readCaptionSrt:async()=>({sourcePath:'C:/captions.srt',scratchPath:'C:/scratch/hash.srt',sha256:'hash',cues:[{startTicks:'0',endTicks:'100'},{startTicks:'100',endTicks:'200'}]})}));
import {registerCaptionTool} from '../../apps/mcp-server/src/caption-tools.js';
describe('caption import public receipt',()=>{
  function fixture(){
    let handler:any,reads=0;
    const before={id:'sid',videoTracks:1,audioTracks:1,captionTracks:1,captionTrackStates:[{index:0,name:'original',muted:false,itemCount:2}],items:[{id:'av',start:{ticks:'0'},end:{ticks:'100'},inPoint:{ticks:'0'},effects:[{huge:'x'.repeat(100000)}]}]};
    const after={...before,captionTracks:2,captionTrackStates:[...before.captionTrackStates,{index:1,id:2,name:'new',muted:false,itemCount:2}]};
    const host={read:vi.fn(async(command:string)=>{
      if(command==='inspect_caption_import_capabilities')return {exactTrackGuards:true,frameTicks:'100',projectId:'pid',sequenceId:'sid'};
      if(command==='inspect_caption_track')return {status:'partial',projectId:'pid',sequenceId:'sid',sequenceName:'s',frameTicks:'100',captionTrackCount:2,track:{...after.captionTrackStates[1],id:'2'},items:[{index:0,startTicks:'0',endTicks:'100'},{index:1,startTicks:'100',endTicks:'200'}]};
      if(command!=='inspect_sequence')throw Error('Unexpected full project scan');return reads++?after:before;
    }),mutate:vi.fn(async()=>({status:'pass',errors:[]})),mutateLocal:vi.fn(async(_c:any,_a:any,run:any)=>{const outcome=await run();return {status:outcome.status,hostResult:outcome.result};})};
    registerCaptionTool({registerTool:(_n:any,_s:any,h:any)=>{handler=h;}} as any,host as any,{} as any);
    const args={expectedProjectId:'pid',expectedSequenceId:'sid',expectedSequenceName:'s',srtPath:'C:/captions.srt',timeSeconds:0,trackName:'new',muted:false,placementMode:'insert',videoTrackIndex:0,audioTrackIndex:0};
    return {handler,host,args};
  }
  it('returns compact verified result with no implicit save or full snapshots',async()=>{
    const {handler,host,args}=fixture(),response=await handler(args);
    expect(response.structuredContent).toMatchObject({status:'pass',hostResult:{projectSaved:false,preservation:{avItemCount:1,avUnchanged:true}}});
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(10000);
    expect(host.mutate.mock.calls.map(c=>c[0])).toEqual(['finalize_caption_import']);
    expect(JSON.stringify(response)).not.toContain('effects');
  });
  it('rejects overwrite before lease/helper dispatch',async()=>{
    const {handler,host,args}=fixture();const calls=f.helper.mock.calls.length;
    expect((await handler({...args,placementMode:'overwrite'})).isError).toBe(true);
    expect(host.mutateLocal).not.toHaveBeenCalled();expect(f.helper.mock.calls).toHaveLength(calls);
    host.read.mockRejectedValueOnce(Error('UNSUPPORTED_COMMAND'));
    const oldPanel=await handler(args);
    expect(oldPanel.isError).toBe(true);expect(JSON.stringify(oldPanel)).toContain('CAPTION_IMPORT_PANEL_UPDATE_REQUIRED');
    expect(host.mutateLocal).not.toHaveBeenCalled();expect(f.helper.mock.calls).toHaveLength(calls);
  });
  it('finds the imported SRT beyond the old 500-item summary without replaying the helper (F)',async()=>{
    const {handler,host,args}=fixture(),originalRead=host.read.getMockImplementation()!;
    let pages=0;
    host.read.mockImplementation(async(command:string,input?:any)=>{
      if(command!=='query_media')return originalRead(command);
      if(input.ids)return {items:[{id:'bin',kind:'folder'}],page:{hasMore:false,scanTruncated:false}} as any;
      const page=pages++;
      expect(input.limit).toBe(100);
      expect(input.cursor).toBe(page===0?undefined:'page-'+page);
      return page<5?{items:[],page:{hasMore:true,scanTruncated:false,nextCursor:'page-'+(page+1)}}:
        {items:[{id:'srt-source',parentId:'root',path:'C:/scratch/hash.srt'}],page:{hasMore:false,scanTruncated:false}} as any;
    });
    const calls=f.helper.mock.calls.length;
    expect((await handler({...args,binId:'bin'})).structuredContent).toMatchObject({status:'pass'});
    expect(pages).toBe(6);expect(f.helper.mock.calls).toHaveLength(calls+1);
    expect(host.mutate).toHaveBeenCalledWith('move_project_items',expect.objectContaining({projectItemIds:['srt-source'],targetBinId:'bin'}),expect.stringContaining(':bin'));
  });
  it('rejects a missing bin before importing any caption content',async()=>{
    const {handler,host,args}=fixture(),originalRead=host.read.getMockImplementation()!;
    host.read.mockImplementation(async(command:string)=>command==='query_media'?{items:[],page:{hasMore:false,scanTruncated:false}} as any:originalRead(command));
    const calls=f.helper.mock.calls.length;
    expect((await handler({...args,binId:'missing'})).structuredContent).toMatchObject({status:'fail',hostResult:{contentDispatched:false}});
    expect(f.helper.mock.calls).toHaveLength(calls);expect(host.mutate).not.toHaveBeenCalled();
  });
  it.each(['ambiguous','truncated','cursor'])('does not replay a caption import when source readback is %s',async fault=>{
    const {handler,host,args}=fixture(),originalRead=host.read.getMockImplementation()!;
    host.read.mockImplementation(async(command:string,input?:any)=>{
      if(command!=='query_media')return originalRead(command);
      if(input.ids)return {items:[{id:'bin',kind:'folder'}],page:{hasMore:false,scanTruncated:false}} as any;
      return {items:[{id:'one',path:'C:/scratch/hash.srt'},...(fault==='ambiguous'?[{id:'two',path:'C:/scratch/hash.srt'}]:[])],
        page:{hasMore:fault==='cursor',nextCursor:'repeated',scanTruncated:fault==='truncated'}} as any;
    });
    const calls=f.helper.mock.calls.length;
    expect((await handler({...args,binId:'bin'})).structuredContent).toMatchObject({status:'unverified',hostResult:{contentDispatched:true}});
    expect(f.helper.mock.calls).toHaveLength(calls+1);expect(host.mutate).not.toHaveBeenCalled();
  });
});
