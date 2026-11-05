import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {it,expect,vi} from 'vitest';
import {registerInspectionTools} from '../../apps/mcp-server/src/inspection-tools.js';
import {registerTimelineEditTools,registerPlacementTools} from '../../apps/mcp-server/src/timeline-edit-tools.js';
import {registerDeliveryTools} from '../../apps/mcp-server/src/delivery-tools.js';
import {registerProjectLifecycleTools,registerProjectMediaTools,registerProjectStructureTools} from '../../apps/mcp-server/src/project-edit-tools.js';
import {registerAgentTools} from '../../apps/mcp-server/src/agent-tools.js';
import {registerEffectTools} from '../../apps/mcp-server/src/effect-tools.js';

it('requires and forwards exact pins for the production tools that previously stripped them',async()=>{
  const server=new McpServer({name:'target-contract',version:'1'}),client=new Client({name:'client',version:'1'});
  const read=vi.fn(async()=>({status:'pass'})),mutate=vi.fn(async()=>({status:'pass'})),host:any={read,mutate};
  const paths:any={authorizeRead:(path:string)=>({path,root:{role:path.includes('/proxy/')?'proxy':'source'}}),authorizeWrite:(path:string)=>({path,root:{role:path.includes('/scratch/')?'scratch':'output'}})};
  registerInspectionTools(server,{} as any,host,paths,{} as any);
  registerTimelineEditTools(server,host);registerDeliveryTools(server,{} as any,host,paths);
  registerPlacementTools(server,host,paths);registerProjectLifecycleTools(server,host,paths);
  registerProjectMediaTools(server,host,paths);registerProjectStructureTools(server,host,paths);
  registerAgentTools(server,host);registerEffectTools(server,host,paths);
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  try {
    const target={expectedProjectId:'p',expectedSequenceId:'original',expectedSequenceName:'Original'};
    for(const [name,args] of Object.entries({inspect_sequence:{},save_working_project:{},set_track_state:{edits:[{mediaType:'audio',trackIndex:0,name:'Voice'}]},clone_clips:{clones:[{trackItemId:'audio:0:0:source',timeOffsetSeconds:0,audioTrackOffset:1}]},place_on_new_layer:{projectItemId:'source',timeSeconds:0},
      set_timeline_item_state:{edits:[{trackItemId:'video:0:0:shared',disabled:true}]},trim_clips:{edits:[{trackItemId:'video:0:0:shared',endSeconds:1}]},
      add_markers:{markers:[{name:'Mark',timeSeconds:0}]},detect_scene_cuts:{trackItemIds:['video:0:0:shared']},
      create_sequence:{name:'New'},create_subclip:{name:'Part',projectItemId:'source',startSeconds:0,endSeconds:1},
      create_working_copy:{outputPath:'C:/scratch/copy.prproj'},activate_sequence:{name:'Destination',sequenceId:'destination'},duplicate_working_sequence:{name:'Copy'},
      set_project_item_labels:{labels:[{projectItemId:'source',colorLabelIndex:1}]},import_media:{filePaths:['C:/source.wav']},attach_proxy:{projectItemId:'source',proxyPath:'C:/proxy/source.mov'},
      export_sequence:{outputPath:'C:/output/export.mp4',presetPath:'C:/preset.epr'},export_frame:{outputPath:'C:/output/frame.png',timeSeconds:0},
      place_voiceover:{filePath:'C:/voice.wav',timeSeconds:0,audioTrackIndex:0},place_music:{filePath:'C:/music.wav',timeSeconds:0,audioTrackIndex:0},
      query_timeline:{},query_media:{},inspect_clip_speech_text:{projectItemId:'source'}
    })) {
      expect((await client.callTool({name,arguments:args})).isError).toBe(true);
      expect((await client.callTool({name,arguments:{...args,...target}})).isError).not.toBe(true);
      const call=['inspect_sequence','query_timeline','query_media','inspect_clip_speech_text'].includes(name)?read.mock.calls.at(-1):mutate.mock.calls.at(-1);
      expect(call).toEqual(expect.arrayContaining([expect.objectContaining(target)]));
    }
    const idsOnly={expectedProjectId:'p',expectedSequenceId:'original'};
    expect((await client.callTool({name:'save_working_project',arguments:idsOnly})).isError).not.toBe(true);
    expect(mutate.mock.calls.at(-1)?.[1]).toEqual(idsOnly);
  } finally {await client.close();await server.close();}
});
