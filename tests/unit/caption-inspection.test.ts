import {afterEach,describe,it,expect,vi} from 'vitest';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {captionSrtDiff,captionItemDiff,parseCaptionSrt,textHash,inspectCaption} from '../../apps/mcp-server/src/caption-inspection.js';
import {captionPreservation} from '../../apps/mcp-server/src/caption-tools.js';
import * as archive from '../../apps/mcp-server/src/premiere-sequence-archive.js';
import {freshTestDirectory} from '../helpers/workspace.js';
afterEach(()=>vi.restoreAllMocks());
describe('caption preview evidence',()=>{
  it.each([null,{r:11,g:22,b:33}])('reports stored cue RGB only as saved evidence: %j',async fillColor=>{
    const directory=await freshTestDirectory('caption-saved-color'),file=path.join(directory,'saved.prproj');await writeFile(file,'unchanged saved bytes');
    vi.spyOn(archive,'snapshotPremiereSequenceArchive').mockResolvedValue({sequenceUid:'sequence',tracks:[{mediaType:'caption',index:1,id:2,name:'Captions',uid:'track',captionCues:[{index:0,startTicks:'0',endTicks:'100',text:'Caption',fontPostScriptName:'ArialMT',fontSize:48,fillColor,contentSha256:'proof'}]}]} as any);
    const read=vi.fn(async()=>({projectPath:file,sequenceName:'Sequence',sequenceId:'sequence',track:{index:1,id:'2',name:'Captions'},items:[{startTicks:'0',endTicks:'100'}]})),mutate=vi.fn();
    const result=await inspectCaption({read,mutate} as any,{});
    expect(result.savedSnapshot).toMatchObject({source:'saved_project_archive',liveTextFreshness:'unverified',guardEligible:false,items:[{style:{fillColor,fillColorSource:fillColor?'stored_rgb_override':'no_stored_override'}}]});
    expect(mutate).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(1);
  });
  const text='황제ᄂᆞᆫ 앉ᄋᆞᆯ\nᄒᆞᄂᆞᆫ ᄇᆡᆨ ';
  const source=`1\r\n00:00:01,000 --> 00:00:02,000\r\n${text.replaceAll('\n','\r\n')}\r\n\r\n`;
  it('preserves old Hangul code points, whitespace and multiline text',()=>{
    const [cue]=parseCaptionSrt(source);expect([...cue!.text]).toEqual([...text]);
    expect(textHash('가')).not.toBe(textHash('가'));
    expect(cue!.startTicks).toBe('254016000000');
    expect(()=>parseCaptionSrt(source.replace('1\r\n','2\r\n'))).toThrow('NUMBER_SEQUENCE');
  });
  it('reports exact text-only differences, blocks count/timing drift and never marks saved text as writable',()=>{
    const cues=parseCaptionSrt(source),snapshot={frameTicks:'8475667200',savedSnapshot:{timingMatchesLive:true,items:[{...cues[0],text:'old'}]}};
    const r=captionSrtDiff(snapshot,cues);
    expect(r).toMatchObject({status:'partial',canApply:false,mappingMatches:true,textChanges:1,contentDispatched:false});
    expect(r.changes[0]).toMatchObject({before:{text:'old'},after:{text,startTicks:cues[0]!.startTicks}});
    expect(captionSrtDiff({...snapshot,savedSnapshot:{...snapshot.savedSnapshot,items:[]}},cues).errors).toContain('SRT_CAPTION_COUNT_MISMATCH');
    expect(captionSrtDiff(snapshot,[{...cues[0]!,startTicks:'0'}]).errors).toContain('SRT_CAPTION_TIME_MISMATCH:0');
    expect(captionSrtDiff({...snapshot,savedSnapshot:{...snapshot.savedSnapshot,timingMatchesLive:false}},cues).errors).toContain('SAVED_TIMING_DIFFERS_FROM_LIVE');
  });
  it('compares AV source bounds, timing/state and refuses truncated proof',()=>{
    const s={id:'s',videoTracks:1,audioTracks:1,captionTrackStates:[],items:[{id:'v',start:{ticks:'0'},end:{ticks:'100'},inPoint:{ticks:'1'},outPoint:{ticks:'101'},speed:1}]};
    const before=captionPreservation(s);expect(captionPreservation({...s,items:[{...s.items[0],inPoint:{ticks:'2'}}]})).not.toEqual(before);
    expect(()=>captionPreservation({...s,itemsTruncated:true})).toThrow('TRUNCATED');
  });
  it('refuses stale item guards and plans partial edits without applying saved evidence',()=>{
    const items=[{text:'가',textSha256:textHash('가'),startTicks:'0',endTicks:'100'},{text:'second',textSha256:textHash('second'),startTicks:'100',endTicks:'200'}];
    const snapshot={frameTicks:'10',savedSnapshot:{fingerprint:'fp',items}};
    const edits=[{itemIndex:0,expectedStartTicks:'0',expectedText:'가',newText:'wrong normalization'},{itemIndex:1,expectedStartTicks:'100',expectedTextSha256:textHash('second'),newText:'updated'}];
    expect(captionItemDiff(snapshot,{expectedFingerprint:'fp',items:edits,conflictPolicy:'abort'})).toMatchObject({aborted:true,plannedItems:0,appliedItems:0});
    expect(captionItemDiff(snapshot,{expectedFingerprint:'fp',items:edits,conflictPolicy:'skip',dryRun:false})).toMatchObject({status:'unsupported',plannedItems:1,appliedItems:0,canApply:false});
    expect(()=>captionItemDiff(snapshot,{expectedFingerprint:'old',items:edits})).toThrow('FINGERPRINT_CHANGED');
  });
});
