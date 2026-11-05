import { afterEach,describe, expect, it,vi } from "vitest";
import type { HostExecutor } from "../../apps/mcp-server/src/host-executor.js";
import { captionStyleAvPreservation,editExistingSequenceStructure, waitForExpectedProject, type ExistingSequenceStructureEdit } from "../../apps/mcp-server/src/existing-sequence-structure.js";
import * as archive from '../../apps/mcp-server/src/premiere-sequence-archive.js';
import { closeReceiptFixture, lifecycleContextFixture, projectViewFixture } from '../fixtures/project-lifecycle.js';
afterEach(()=>vi.restoreAllMocks());

const sequence = {
  id: "f8bfff22-1e33-4ebe-90d4-654fcaa225d2",
  name: "WORKING__TEST",
  videoTracks: 1,
  audioTracks: 1,
  captionTracks: 1,
  itemLimit: 1_000,
  itemsTruncated: false,
  items: [],
  tracks: [],
  captionTrackStates: [],
  transitions: [],
};

const project = {
  projectId: "project-1",
  projectName: "working.prproj",
  projectPath: "C:\\scratch\\working.prproj",
  capturedAt: "2026-09-04T00:00:00.000Z",
  activeSequence: sequence,
  sequences: [{ id: sequence.id, name: sequence.name }],
  projectItems: [],
  projectItemLimit: 500,
  projectItemsTruncated: false,
  offlineMediaIds: [],
  proxyAttachments: [],
  markers: [],
  mogrtItems: [],
  effects: [],
  audioState: [],
  unsupportedFields: [],
};

const edit: ExistingSequenceStructureEdit = {
  expectedProjectPath: project.projectPath,
  expectedSequenceName: sequence.name,
  expectedSequenceUid: sequence.id,
  removeTracks: [],
};
const lifecycleTarget={projectId:project.projectId,projectPath:project.projectPath,sequenceId:sequence.id,sequenceName:sequence.name};

function nativeGraphicFixture(){
  const item={id:'video:0:0:',name:'그래픽',projectItemId:'',mediaType:'video',trackIndex:0,start:{ticks:'0',seconds:0},end:{ticks:'100',seconds:1},inPoint:{ticks:'500',seconds:5},outPoint:{ticks:'600',seconds:6},speed:1,reversed:false,disabled:false,adjustmentLayer:false};
  const snapshot={...sequence,items:[item]};
  const hostProject={...project,activeSequence:snapshot,effects:[{trackItemId:item.id,name:item.name,mediaType:item.mediaType,components:['AE.ADBE Opacity','AE.ADBE Graphic Group','AE.ADBE Text'].map((matchName,componentIndex)=>({componentIndex,matchName}))}]};
  return {snapshot,hostProject};
}

describe("existing sequence lifecycle observation", () => {
  it('accepts native graphics without ProjectItem IDs and compares the exact slot and ordered chain',()=>{
    const {snapshot,hostProject}=nativeGraphicFixture(),original=captionStyleAvPreservation(snapshot,hostProject as any);
    const reopened=structuredClone({snapshot,hostProject});
    reopened.snapshot.items[0]!.id='new-wrapper';reopened.hostProject.activeSequence.items[0]!.id='new-wrapper';reopened.hostProject.effects[0]!.trackItemId='new-wrapper';
    expect(captionStyleAvPreservation(reopened.snapshot,reopened.hostProject as any)).toBe(original);
    reopened.hostProject.effects[0]!.components.splice(1,0,{componentIndex:1,matchName:'AE.ADBE Gaussian Blur'});
    reopened.hostProject.effects[0]!.components.forEach((component,index)=>component.componentIndex=index);
    expect(captionStyleAvPreservation(reopened.snapshot,reopened.hostProject as any)).not.toBe(original);
    for(const change of [{start:{ticks:'1',seconds:0}},{inPoint:{ticks:'501',seconds:5}},{name:'renamed'},{disabled:true},{speed:2},{reversed:true},{trackIndex:1}]){
      const changed=nativeGraphicFixture();Object.assign(changed.snapshot.items[0]!,change);changed.hostProject.effects[0]!.name=changed.snapshot.items[0]!.name;
      expect(captionStyleAvPreservation(changed.snapshot,changed.hostProject as any)).not.toBe(original);
    }
  });
  it('treats the Graphic Group slot that Premiere re-creates on reopen as unchanged, but not stored chain changes',()=>{
    // 2026-11-03 live: in-session effects inserted before the Graphic Group read back after reopen with the group right after Motion; frames were pixel-identical.
    const chain=(...names:string[])=>names.map((matchName,componentIndex)=>({componentIndex,matchName}));
    const proof=(components:ReturnType<typeof chain>)=>{const fixture=nativeGraphicFixture();fixture.hostProject.effects[0]!.components=components;return captionStyleAvPreservation(fixture.snapshot,fixture.hostProject as any);};
    const inSession=proof(chain('AE.ADBE Opacity','AE.ADBE Motion','AE.ADBE Tint','AE.ADBE Gaussian Blur','AE.ADBE Graphic Group','AE.ADBE Text'));
    expect(proof(chain('AE.ADBE Opacity','AE.ADBE Motion','AE.ADBE Graphic Group','AE.ADBE Tint','AE.ADBE Gaussian Blur','AE.ADBE Text'))).toBe(inSession);
    for(const changed of [
      chain('AE.ADBE Opacity','AE.ADBE Motion','AE.ADBE Graphic Group','AE.ADBE Gaussian Blur','AE.ADBE Tint','AE.ADBE Text'),
      chain('AE.ADBE Opacity','AE.ADBE Motion','AE.ADBE Graphic Group','AE.ADBE Tint','AE.ADBE Text'),
      chain('AE.ADBE Opacity','AE.ADBE Motion','AE.ADBE Tint','AE.ADBE Gaussian Blur','AE.ADBE Text'),
      chain('AE.ADBE Opacity','AE.ADBE Motion','AE.ADBE Graphic Group','AE.ADBE Tint','AE.ADBE Text','AE.ADBE Gaussian Blur'),
    ])expect(proof(changed)).not.toBe(inSession);
    expect(()=>proof(chain('AE.ADBE Opacity','AE.ADBE Graphic Group','AE.ADBE Graphic Group','AE.ADBE Text'))).toThrow('GRAPHIC_PROOF_INCOMPLETE');
  });
  it.each(['missing-project','missing-source-field','audio','missing-bounds','no-graphic-chain','partial-chain','missing-effects','duplicate-effects','duplicate-slot','duplicate-slot-distinct-id','project-race','project-truncated'] as const)('refuses incomplete or ambiguous native graphic proof: %s',fault=>{
    const {snapshot,hostProject}=nativeGraphicFixture();
    if(fault==='missing-project')expect(()=>captionStyleAvPreservation(snapshot)).toThrow('GRAPHIC_PROOF_INCOMPLETE');
    else{
      if(fault==='missing-source-field')delete (snapshot.items[0] as any).projectItemId;
      if(fault==='audio')snapshot.items[0]!.mediaType='audio';
      if(fault==='missing-bounds')delete (snapshot.items[0] as any).inPoint;
      if(fault==='no-graphic-chain')hostProject.effects[0]!.components=[{componentIndex:0,matchName:'AE.ADBE Motion'}];
      if(fault==='partial-chain')hostProject.effects[0]!.components[1]!.componentIndex=4;
      if(fault==='missing-effects')hostProject.effects=[];
      if(fault==='duplicate-effects')hostProject.effects.push(structuredClone(hostProject.effects[0]!));
      if(fault==='duplicate-slot')snapshot.items.push(structuredClone(snapshot.items[0]!));
      if(fault==='duplicate-slot-distinct-id'){snapshot.items.push({...structuredClone(snapshot.items[0]!),id:'other-wrapper'});hostProject.effects.push({...structuredClone(hostProject.effects[0]!),trackItemId:'other-wrapper'});}
      if(fault==='project-race'){hostProject.activeSequence=structuredClone(snapshot);hostProject.activeSequence.items[0]!.end.ticks='101';}
      if(fault==='project-truncated'){hostProject.activeSequence=structuredClone(snapshot);hostProject.activeSequence.itemsTruncated=true;}
      expect(()=>captionStyleAvPreservation(snapshot,hostProject as any)).toThrow('GRAPHIC_PROOF_INCOMPLETE');
    }
  });
  it('proves AV timing/source bounds and track state, not just item count',()=>{
    const input={...sequence,items:[{id:'clip',projectItemId:'source',mediaType:'video',trackIndex:0,start:{ticks:'0'},end:{ticks:'100'},inPoint:{ticks:'0'},outPoint:{ticks:'100'},speed:1}]};
    for(const change of [{start:{ticks:'1'},end:{ticks:'101'}},{inPoint:{ticks:'2'}},{projectItemId:'different'},{speed:2},{disabled:true}])expect(captionStyleAvPreservation({...input,items:[{...input.items[0],...change}]})).not.toBe(captionStyleAvPreservation(input));
    expect(captionStyleAvPreservation({...input,items:[{...input.items[0],id:'new-wrapper-id'}]})).toBe(captionStyleAvPreservation(input));
    expect(()=>captionStyleAvPreservation({...input,itemsTruncated:true})).toThrow('TRUNCATED');
  });
  it.each(['pass','graphic-pass','graphic-chain-drift','graphic-incomplete','initial-throw','initial-unverified','roundtrip-throw','roundtrip-unverified','ignored-style','av-drift','truncated-after','stale','close-boolean-only','close-unverified','close-false','close-wrong-event','close-other-project'] as const)('requires a saved host roundtrip and never rolls back an uncertain save: %s',async fault=>{
    const calls:string[]=[],hostSequence={...sequence,items:[{id:'clip',name:'Video',projectItemId:'source',mediaType:'video',trackIndex:0,start:{ticks:'0',seconds:0},end:{ticks:'100',seconds:1}}],captionTrackStates:[{id:1,index:0,name:'Captions',itemCount:1,transitionCount:0,muted:false}]};
    const graphic=nativeGraphicFixture();if(fault.startsWith('graphic'))hostSequence.items=[graphic.snapshot.items[0]!];
    const hostProject={...project,activeSequence:hostSequence,effects:fault.startsWith('graphic')&&fault!=='graphic-incomplete'?graphic.hostProject.effects:[]};
    const before:any={projectPath:project.projectPath,sequenceName:sequence.name,sequenceUid:sequence.id,trackCounts:{video:1,audio:1,caption:1},totalItems:1,tracks:[{uid:'caption-track',id:1,index:0,name:'Captions',mediaType:'caption',itemCount:1,transitionCount:0,empty:false,captionCues:[{index:0,itemObjectId:'old',blockObjectId:'block',startTicks:'0',endTicks:'100',text:'Caption',fontPostScriptName:'ArialMT',fontSize:48,fillColor:null,preservedStyleSha256:'kept',contentSha256:'old'}]}]};
    const after=structuredClone(before);Object.assign(after.tracks[0].captionCues[0],{itemObjectId:'renumbered',blockObjectId:'renumbered-block',fillColor:{r:11,g:22,b:33},contentSha256:'new'});
    let snapshots=0,saves=0,active=true;
    vi.spyOn(archive,'snapshotPremiereSequenceArchive').mockImplementation(async()=>{calls.push('snapshot'+(++snapshots));return structuredClone(snapshots===1||fault==='ignored-style'?before:after);});
    vi.spyOn(archive,'readPremiereArchiveXml').mockResolvedValue({xml:'fixture',compressed:false,sha256:'fixture-sha'});
    vi.spyOn(archive,'patchPremiereSequenceArchive').mockImplementation(()=>{if(fault==='stale')throw Error('STALE_CAPTION_CUE_TARGET');return {xml:'candidate',before,after};});
    const commit=vi.spyOn(archive,'commitPremiereSequenceArchive').mockResolvedValue({before,after,backupPath:'C:/scratch/backup.prproj'} as any);
    const restore=vi.spyOn(archive,'restorePremiereSequenceArchive');
    const host={read:async(command:string)=>{calls.push(command);if(command==='inspect_project')return structuredClone(hostProject);if(command==='inspect_sequence')return structuredClone(hostSequence);if(command==='inspect_host_context')return lifecycleContextFixture(lifecycleTarget,active);throw Error(command);},
      mutate:async(_command:string,args:Record<string,unknown>)=>{expect(args.expectedProjectPath).toBe(project.projectPath);calls.push('save'+(++saves));if(fault===(saves===1?'initial-throw':'roundtrip-throw'))throw Error('save response lost');if(saves===2&&fault==='av-drift')hostSequence.items[0]!.start.ticks='1';if(saves===2&&fault==='graphic-chain-drift')hostProject.effects[0]!.components[0]!.matchName='AE.ADBE Motion';if(saves===2&&fault==='truncated-after')hostSequence.itemsTruncated=true;return {commandId:'save-'+saves,status:fault===(saves===1?'initial-unverified':'roundtrip-unverified')?'unverified':'pass',errors:[]};},
      mutateLifecycle:async(command:string,args:Record<string,unknown>)=>{calls.push(command);expect(args.requireExclusiveProject).toBe(true);active=command==='open_working_project';if(active)return {commandId:command,status:'pass',errors:[]};const receipt=closeReceiptFixture(lifecycleTarget);if(fault==='close-boolean-only')return {commandId:command,status:'pass',errors:[],hostResult:{saved:true,closed:true}};if(fault==='close-unverified')receipt.status='unverified';if(fault==='close-false')receipt.hostResult.closed=false;if(fault==='close-wrong-event')receipt.hostResult.closeVerification.closedEvent.path='C:/scratch/copy.prproj';if(fault==='close-other-project'){receipt.hostResult.closeVerification.openProjects.projects=[projectViewFixture({...lifecycleTarget,projectPath:'C:/scratch/copy.prproj'})];receipt.hostResult.closeVerification.openProjects.viewCount=1;}return receipt;}} as unknown as HostExecutor;
    const request={...edit,captionStyle:{trackUid:'caption-track',expectedTrackId:1,expectedTrackName:'Captions',expectedItemCount:1,items:[{itemIndex:0,expectedStartTicks:'0',expectedEndTicks:'100',fillColor:{r:11,g:22,b:33}}]}};
    if(fault==='stale'){await expect(editExistingSequenceStructure(host,request,'operation')).rejects.toThrow('STALE');expect(calls).not.toContain('close_working_project');}
    else{const result=await editExistingSequenceStructure(host,request,'operation');expect(result.status).toBe(fault==='graphic-incomplete'?'fail':fault==='pass'||fault==='graphic-pass'?'pass':'unverified');
      if(fault==='graphic-incomplete'){expect(result.changedFiles).toEqual([]);expect(result.result).toMatchObject({phase:'preflight',contentDispatched:false});expect(calls).not.toContain('save1');}
      else expect(result.changedFiles).toContain(project.projectPath);
      if(fault==='pass'||fault==='graphic-pass')expect(calls.indexOf('snapshot2')).toBeGreaterThan(calls.indexOf('save2'));
      if(fault==='graphic-pass')expect((result.result as any).avPreservation).toMatchObject({nativeGraphicItems:1,nativeGraphicSourceContent:'unverified'});
    }
    expect(restore).not.toHaveBeenCalled();expect(calls.filter(c=>c==='close_working_project').length).toBe(fault.startsWith('initial')||fault==='stale'||fault==='graphic-incomplete'?0:1);
    expect(calls).not.toContain('get_capabilities');
    if(fault.startsWith('close-')){expect(commit).not.toHaveBeenCalled();expect(calls).not.toContain('open_working_project');expect(saves).toBe(1);}
  });
  it("rejects combining native track removal with an archive caption-style edit before host access", async () => {
    const host = {
      async read(): Promise<never> {
        throw new Error("host must not be read");
      },
    } as unknown as HostExecutor;
    const combined: ExistingSequenceStructureEdit = {
      ...edit,
      removeTracks: [{
        mediaType: "video",
        index: 1,
        id: 2,
        uid: "video-track-2",
        name: "Video 2",
        expectedHostName: "Video 2",
        expectedItemCount: 0,
        expectedTransitionCount: 0,
      }],
      captionStyle: {
        trackUid: "caption-track-1",
        expectedTrackId: 1,
        expectedTrackName: "Captions",
        expectedItemCount: 48,
        fontPostScriptName: "NotoSansKR-Medium",
        fontSize: 52,
      },
    };

    await expect(editExistingSequenceStructure(host, combined, "00000000-0000-4000-8000-000000000001"))
      .rejects.toThrowError("SEPARATE_TRACK_REMOVAL_AND_CAPTION_STYLE_EDITS_REQUIRED");
  });

  it.each(['caption','native-track'] as const)('rejects conflicting/unknown project views before the first save in %s workflow',async route=>{
    for(const fault of ['same-guid','other-guid','active-path','read-error'] as const){
      const track={mediaType:'video' as const,index:0,id:1,name:'Video 1',itemCount:0,transitionCount:0,muted:false};
      const hostSequence={...sequence,tracks:[track],captionTrackStates:[{index:0,id:1,name:'Captions',itemCount:1,transitionCount:0 as const,muted:false}]};
      const context=lifecycleContextFixture(lifecycleTarget);
      if(fault==='active-path')context.projectPath='C:/scratch/copy.prproj';
      else if(fault!=='read-error'){context.openProjects.projects.push(projectViewFixture({...lifecycleTarget,projectId:fault==='same-guid'?project.projectId:'other',projectPath:'C:/scratch/copy.prproj'},['view-2']));context.openProjects.viewCount=2;}
      const host={read:vi.fn(async(command:string,args?:Record<string,unknown>)=>{
        if(command==='inspect_project')return {...project,activeSequence:hostSequence};
        if(command==='inspect_sequence')return hostSequence;
        if(command==='inspect_host_context'){expect(args).toEqual({includeOpenProjects:true});if(fault==='read-error')throw Error('view invalidated');return context;}
        throw Error(command);
      }),mutate:vi.fn(),mutateLifecycle:vi.fn()};
      const request:ExistingSequenceStructureEdit=route==='native-track'?{...edit,trackRemovalRoute:'native',removeTracks:[{...track,uid:'video-track',expectedHostName:track.name,expectedItemCount:0,expectedTransitionCount:0}]}:{...edit,captionStyle:{trackUid:'caption-track',expectedTrackId:1,expectedTrackName:'Captions',expectedItemCount:1,fontPostScriptName:'ArialMT',fontSize:52}};
      const result=await editExistingSequenceStructure(host as unknown as HostExecutor,request,'preflight-'+route+'-'+fault);
      expect(result).toMatchObject({status:'fail',changedFiles:[],result:{phase:'preflight',contentDispatched:false}});
      expect(host.mutate).not.toHaveBeenCalled();expect(host.mutateLifecycle).not.toHaveBeenCalled();
      if(fault==='same-guid')expect(result.errors[0]).toContain('DUPLICATE_OPEN_PROJECT_GUID');
      if(fault==='other-guid')expect(result.errors[0]).toContain('PROJECT_LIFECYCLE_MULTIPLE_PROJECTS');
    }
  });

  it("waits on the lightweight host context before one full project readback", async () => {
    const calls: string[] = [];
    let contextReads = 0;
    const host = {
      async read(command: string): Promise<unknown> {
        calls.push(command);
        if (command === "inspect_host_context") {
          contextReads += 1;
          return contextReads === 1
            ? { activeProject: false, activeSequence: false }
            : { activeProject: true, activeSequence: true, projectPath: project.projectPath, sequenceId: sequence.id, sequenceName: sequence.name };
        }
        if (command === "inspect_project") return project;
        if (command === "inspect_sequence") return sequence;
        throw new Error(`Unexpected command: ${command}`);
      },
    } as unknown as HostExecutor;

    const observation = await waitForExpectedProject(host, edit, 2_000);

    expect(observation).toMatchObject({ status: "pass", attempts: 2 });
    expect(calls).toEqual(["inspect_host_context", "inspect_host_context", "inspect_project", "inspect_sequence"]);
  });

  it("keeps polling the same reopened project while media is still resolving", async () => {
    const calls: string[] = [];
    let projectReads = 0;
    const host = {
      async read(command: string): Promise<unknown> {
        calls.push(command);
        if (command === "inspect_host_context") {
          return { activeProject: true, activeSequence: true, projectPath: project.projectPath, sequenceId: sequence.id, sequenceName: sequence.name };
        }
        if (command === "inspect_project") {
          projectReads += 1;
          return projectReads === 1 ? { ...project, offlineMediaIds: ["pending-1", "pending-2"] } : project;
        }
        if (command === "inspect_sequence") return sequence;
        throw new Error(`Unexpected command: ${command}`);
      },
    } as unknown as HostExecutor;

    const observation = await waitForExpectedProject(host, edit, 2_000, { offlineMediaCount: 0, markerCount: 0 });

    expect(observation).toMatchObject({ status: "pass", attempts: 2 });
    expect(calls).toEqual([
      "inspect_host_context", "inspect_project", "inspect_sequence",
      "inspect_host_context", "inspect_project", "inspect_sequence",
    ]);
  });
});
