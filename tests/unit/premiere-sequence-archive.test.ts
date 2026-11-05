import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import referenceFirstSource from '../fixtures/premiere-sequence-reference-before-definition.json';
import {
  commitPremiereSequenceArchive,
  inspectCaptionCueBinary,
  inspectCaptionStyleBinary,
  inspectPremiereSequenceArchive,
  patchCaptionCueBinary,
  patchCaptionStyleBinary,
  patchPremiereSequenceArchive,
  restorePremiereSequenceArchive,
  captionStyleReadbackErrors,
  readPremiereArchiveXml,
} from "../../apps/mcp-server/src/premiere-sequence-archive.js";

const captionStyle = "dAEAAAAAAABEMyIRDAAAAAAABgAKAAQABgAAAGQAAAAAAF4APAAUABAAAAAAADgANAAAAAAAAAAAADAALwAoAAAAJAAgABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAgAAAAAABsABwBeAAAAAAAAATQAAAAAAAABUAAAAGgAAAAAAAAAAABAQQAAwEAAAEBAAADIQgAAAAEoAAAAAgAAAAIAAABE////SP///wQABgAEAAAAAAAKAAgABQAGAAcACgAAAAAAAAABAAAABAAAAA0AAABMdWNpZGFDb25zb2xlAAAAAQAAAAwAAAAIAAwABAAIAAgAAAAIAAAAQAAAAAEAAABhADYAGAAAABQAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAACAAEADYAAAACAAAAEAAAABAAAAAAAIBAAABAQvT////4/////P///wQABAAEAAAA";
const captionCue = "/AIAAAAAAABEMyIRDAAAAAAABgAKAAQABgAAAGQAAAAAAF4ATAAUABAAAAAAAEgARAAAAAAAAAAAAEAAPwA4AAAANAAwACwAKAAAACQAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAAAAAAAAAAAAADwAAAAgAAAAAAB8ABwBeAAAAAAAAAUQAAAAAAAABgAAAAJwAAAA8AAAAAAAAAAAAIEEAAAAAWAAAAAAAQEEAAMBAAABAQAAAyEIAAAABSAAAAAIAAAACAAAAzP3//9D9//8BAAAADAAAAAAABgAIAAQABgAAAAQAAAANAAAAQW5pbWF0aW9uVHlwZQAAABL+//8AAAAAGv7//wAAAAABAAAABAAAABEAAABOb3RvU2Fuc0tSLU1lZGl1bQAAAAEAAAAMAAAACAAMAAQACAAIAAAACAAAAHwBAAA6AQAA7ZiE64yA7Ja0OiBb64u57Zmp7KCcXSDtlZjripgg7JWE656YIOychOyVhOuemOqwgCDtnZTrk6TrpqzripQg6rKD7J2AIOqzoOq1rOugpOyZgCDrsLHsoJzqsIAg64yA64u57J20IOyEuOyatCDsnITslYTrnpjrpbwg65Sw66W07KeAIOyViuuKlCDtg5PsnbTri6QuDeuwnOydjDogdGluMSBoYWE2IHppMSB6ZW9pNiBseXVuNiBqYW4xIGdvdTEgZ2F1MSBsYWk0IGJhYWszIHphaTMgYmF0MSBjdW5nNCBkYWFpNiB0b25nNCB6aTEgemVvaTYgamFhNQ1UVFM6IOWkqeS4i+S5i+W6j+S6giDlm6Dpq5jlj6Xpupfnmb7mv5/kuI3lvp7lpKfllJDkuYvluo/kuZ8AAAAANgAcAAAAGAAAAAAAFAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAIAAQANgAAAAIAAAAUAAAAGAAAAAAAAAAgAAAAAABEQuD///8EAAYABAAAAAAACgAIAAUABgAHAAoAAAAAAAAABAAEAAQAAAA=";

function track(tagName: string, uid: string, id: number, index: number, name: string, itemRefs: string[], style = ""): string {
  const mediaType = tagName === "VideoClipTrack"
    ? "228cda18-3625-4d2d-951e-348879e4ed93"
    : tagName === "AudioClipTrack"
      ? "80b8e3d5-6dca-4195-aefb-cb5f407ab009"
      : "d8143ffe-eec4-4d2a-a909-d5f7bf094dc5";
  return `<${tagName} ObjectUID="${uid}"><ClipTrack><Track><Node><Properties>${name ? `<MZ.TrackName>${name}</MZ.TrackName>` : ""}</Properties></Node><ID>${id}</ID><MediaType>${mediaType}</MediaType><Index>${index}</Index></Track><ClipItems><Index>${index}</Index><TrackItems>${itemRefs.map((ref, itemIndex) => `<TrackItem Index="${itemIndex}" ObjectRef="${ref}"/>`).join("")}</TrackItems></ClipItems><TransitionItems><Index>${index}</Index><TrackItems></TrackItems></TransitionItems></ClipTrack>${style}</${tagName}>`;
}

function fixture(): string {
  return `<PremiereData>
<Sequence ObjectUID="sequence-uid"><Node><Properties><HSL.Test.DataPatches>[{"mNumber":-1,"mState":0},{"mNumber":0,"mState":2}]</HSL.Test.DataPatches></Properties></Node><TrackGroups>
<TrackGroup><First>228cda18-3625-4d2d-951e-348879e4ed93</First><Second ObjectRef="vg"/></TrackGroup>
<TrackGroup><First>80b8e3d5-6dca-4195-aefb-cb5f407ab009</First><Second ObjectRef="ag"/></TrackGroup>
<TrackGroup><First>d8143ffe-eec4-4d2a-a909-d5f7bf094dc5</First><Second ObjectRef="cg"/></TrackGroup>
</TrackGroups><Name>WORKING__TEST</Name></Sequence>
<VideoTrackGroup ObjectID="vg"><TrackGroup><Tracks><Track Index="0" ObjectURef="v0"/><Track Index="1" ObjectURef="v1"/></Tracks></TrackGroup></VideoTrackGroup>
<AudioTrackGroup ObjectID="ag"><TrackGroup><Tracks><Track Index="0" ObjectURef="a0"/><Track Index="1" ObjectURef="a1"/></Tracks></TrackGroup><MasterTrack ObjectRef="master"/></AudioTrackGroup>
<DataTrackGroup ObjectID="cg"><TrackGroup><Tracks><Track Index="0" ObjectURef="c0"/><Track Index="1" ObjectURef="c1"/></Tracks></TrackGroup></DataTrackGroup>
${track("VideoClipTrack", "v0", 1, 0, "VIDEO", ["1"])}
${track("VideoClipTrack", "v1", 2, 1, "EMPTY_VIDEO", [])}
${track("AudioClipTrack", "a0", 3, 0, "AUDIO", ["2"])}
${track("AudioClipTrack", "a1", 4, 1, "EMPTY_AUDIO", [])}
<AudioTrackInlet ObjectID="inlet"><Sources><Source Index="0" ObjectURef="a0"/><Source Index="1" ObjectURef="a1"/></Sources></AudioTrackInlet>
<AudioMixTrack ObjectID="master"><Inlet ObjectRef="inlet"/></AudioMixTrack>
${track("CaptionDataClipTrack", "c0", 5, 0, "", [], `<CaptionDataTemplateStyle Encoding="base64" BinaryHash="old-empty">${captionStyle}</CaptionDataTemplateStyle>`)}
${track("CaptionDataClipTrack", "c1", 6, 1, "CAPTION", ["3"], `<CaptionDataTemplateStyle Encoding="base64" BinaryHash="old-caption">${captionStyle}</CaptionDataTemplateStyle>`)}
<CaptionDataClipTrackItem ObjectID="3"><DataClipTrackItem><ClipTrackItem><TrackItem><End>1262874412800</End></TrackItem></ClipTrackItem></DataClipTrackItem><BlockVector><BlockVectorItem Index="0" ObjectRef="4"/></BlockVector></CaptionDataClipTrackItem>
<Block ObjectID="4"><FormattedTextData Encoding="base64" BinaryHash="bbb78cec-ab5f-9f9a-c278-367800000314">${captionCue}</FormattedTextData></Block>
</PremiereData>`;
}

const emptyRemoval = {
  video: { mediaType: 'video' as const, index: 1, id: 2, uid: 'v1', name: 'EMPTY_VIDEO', expectedItemCount: 0 as const, expectedTransitionCount: 0 as const },
  audio: { mediaType: 'audio' as const, index: 1, id: 4, uid: 'a1', name: 'EMPTY_AUDIO', expectedItemCount: 0 as const, expectedTransitionCount: 0 as const },
  caption: { mediaType: 'caption' as const, index: 0, id: 5, uid: 'c0', name: '', expectedItemCount: 0 as const, expectedTransitionCount: 0 as const },
};
function removeEmpty(source: string, mediaType: keyof typeof emptyRemoval = 'video') {
  return patchPremiereSequenceArchive(source, { sequenceName: 'WORKING__TEST', expectedSequenceUid: 'sequence-uid', removeTracks: [emptyRemoval[mediaType]] });
}

describe('track-removal ownership and saved-byte freshness', () => {
  it.each(['video', 'audio', 'caption'] as const)('rejects another sequence sharing the %s group even with unchanged track UID counts', mediaType => {
    const source = fixture();
    const definition = /<Sequence\b[^>]*>[\s\S]*?<\/Sequence>/.exec(source)![0];
    const shared = definition.replace('ObjectUID="sequence-uid"', 'ObjectUID="other-sequence"').replace('<Name>WORKING__TEST</Name>', '<Name>OTHER</Name>');
    expect(() => removeEmpty(source.replace('</PremiereData>', shared + '</PremiereData>'), mediaType)).toThrow('UNSUPPORTED_TRACK_GROUP_OWNERSHIP');
  });

  it('rejects external group references and duplicate media-group slots', () => {
    expect(() => removeEmpty(fixture().replace('</PremiereData>', '<Unexpected ObjectRef="vg"/></PremiereData>'))).toThrow('UNSUPPORTED_TRACK_GROUP_OWNERSHIP');
    const group = /<TrackGroup><First>228cda18[^]*?<\/TrackGroup>/.exec(fixture())![0];
    expect(() => removeEmpty(fixture().replace(group, group + group))).toThrow('PROJECT_ARCHIVE_TRACK_GROUP_NOT_UNIQUE');
  });

  it.each([['video', 'v0'], ['caption', 'c1']] as const)('rejects a shared retained %s track, including a survivor that would be reindexed', (mediaType, uid) => {
    expect(() => removeEmpty(fixture().replace('</PremiereData>', `<Unexpected ObjectURef="${uid}"/></PremiereData>`), mediaType)).toThrow('UNSUPPORTED_TRACK_REFERENCE_GRAPH: ' + uid);
  });

  it.each(['master', 'inlet'] as const)('rejects shared audio %s ownership without changing the track UID counts', id => {
    expect(() => removeEmpty(fixture().replace('</PremiereData>', `<Unexpected ObjectRef="${id}"/></PremiereData>`), 'audio')).toThrow('UNSUPPORTED_AUDIO_INLET_OWNERSHIP');
  });

  it('rejects a reordered/mismatched audio inlet and an unowned inlet', () => {
    const changed = fixture().replace('<Source Index="0" ObjectURef="a0"/><Source Index="1" ObjectURef="a1"/>', '<Source Index="0" ObjectURef="a1"/><Source Index="1" ObjectURef="a0"/>');
    expect(() => removeEmpty(changed, 'audio')).toThrow('UNSUPPORTED_AUDIO_INLET_OWNERSHIP: source layout');
    expect(() => removeEmpty(fixture().replace('<MasterTrack ObjectRef="master"/>', ''), 'audio')).toThrow('UNSUPPORTED_AUDIO_INLET_OWNERSHIP');
  });

  it('changes only the owned audio inlet and preserves its non-source state and unrelated objects', () => {
    const retained = '<OpaqueEffects><Unknown value="unchanged"/></OpaqueEffects>';
    const unrelated = '<AudioTrackInlet ObjectID="other-inlet"><Sources><Source Index="0" ObjectURef="other-audio"/></Sources><Private>keep</Private></AudioTrackInlet><Marker ObjectID="marker"><Name>keep marker</Name></Marker>';
    const source = fixture().replace('</AudioTrackInlet>', retained + '</AudioTrackInlet>').replace('</PremiereData>', unrelated + '</PremiereData>');
    const result = removeEmpty(source, 'audio');
    expect(result.xml).toContain(unrelated);
    expect(result.xml).toContain(retained);
    expect(result.xml).toContain('<Sources><Source Index="0" ObjectURef="a0"/></Sources>');
    expect(result.after.tracks.filter(t => t.mediaType !== 'audio')).toEqual(result.before.tracks.filter(t => t.mediaType !== 'audio'));
  });

  it('does not commit when saved bytes changed after candidate preflight', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'premiere-archive-freshness-'));
    const projectPath = path.join(directory, 'Project.prproj');
    try {
      await writeFile(projectPath, fixture());
      const baseline = await readPremiereArchiveXml(projectPath);
      const changed = fixture().replace('<Name>WORKING__TEST</Name>', '<Name>WORKING__TEST</Name><ChangedAfterPreflight>true</ChangedAfterPreflight>');
      await writeFile(projectPath, changed);
      await expect(commitPremiereSequenceArchive({ projectPath, sequenceName: 'WORKING__TEST', expectedSequenceUid: 'sequence-uid', expectedSourceSha256: baseline.sha256, removeTracks: [emptyRemoval.video] }, '11111111-2222-4333-8444-555555555555')).rejects.toThrow('PROJECT_ARCHIVE_CHANGED_SINCE_PREFLIGHT');
      expect(await readFile(projectPath, 'utf8')).toBe(changed);
    } finally {
      expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()));
      expect(path.basename(directory).startsWith('premiere-archive-freshness-')).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

// Real dryrun5 reference/definition openings with independent synthetic tracks.
// The saved source project is never needed or modified by these portable tests.
function referenceFirstFixture(sequences = referenceFirstSource.sequences): string {
  const original = fixture();
  const definition = /<Sequence\b[^>]*>[\s\S]*?<\/Sequence>/.exec(original)![0];
  const definitions = sequences.map(sequence => definition
    .replace(/^<Sequence\b[^>]*>/, sequence.definitionOpen)
    .replace('<Name>WORKING__TEST</Name>', `<Name>${sequence.name}</Name>`));
  return original.replace(definition, [...referenceFirstSource.references, ...definitions].join('\n'));
}

describe('saved sequence definitions after source references', () => {
  it.each(referenceFirstSource.sequences)('selects the paired ObjectUID for $name among all four definitions', sequence => {
    const source = referenceFirstFixture();
    const result = inspectPremiereSequenceArchive(source, sequence.name);
    expect(result.sequenceUid).toBe(sequence.uid);
    expect(result.trackCounts).toEqual({ video: 2, audio: 2, caption: 2 });
    expect(result.tracks.find(track => track.uid === 'c1')?.captionCues).toHaveLength(1);
  });

  it('patches only the selected definition/tracks and retains the preceding actual source references', () => {
    const sequence = referenceFirstSource.sequences[0]!;
    const source = referenceFirstFixture([sequence]);
    const before = inspectPremiereSequenceArchive(source, sequence.name);
    const result = patchPremiereSequenceArchive(source, {
      sequenceName: sequence.name, expectedSequenceUid: sequence.uid,
      removeTracks: [{ mediaType: 'caption', index: 0, id: 5, uid: 'c0', name: '', expectedItemCount: 0, expectedTransitionCount: 0 }],
      captionStyle: { trackUid: 'c1', expectedTrackId: 6, expectedTrackName: 'CAPTION', expectedItemCount: 1, fontPostScriptName: 'NotoSansKR-Medium', fontSize: 52 },
    });
    expect(result.before.sequenceUid).toBe(sequence.uid);
    expect(result.after.sequenceUid).toBe(sequence.uid);
    expect(result.after.trackCounts).toEqual({ video: 2, audio: 2, caption: 1 });
    const caption = result.after.tracks.find(track => track.uid === 'c1')!;
    expect(caption).toMatchObject({ index: 0, style: { fontSize: 52 }, captionCues: [{ fontSize: 52 }] });
    expect(caption.captionCues![0]!.text).toBe(before.tracks.find(track => track.uid === 'c1')!.captionCues![0]!.text);
    for (const reference of referenceFirstSource.references) expect(result.xml.split(reference)).toHaveLength(2);
    expect(result.after.tracks.filter(track => track.mediaType !== 'caption')).toEqual(before.tracks.filter(track => track.mediaType !== 'caption'));
  });

  it('ignores a self-closing ObjectUID and paired ObjectURef rather than swallowing the later definition', () => {
    const sequence = referenceFirstSource.sequences[0]!;
    const decoys = `<Sequence ObjectUID="decoy" />\n<Sequence ObjectURef="${sequence.uid}"><Name>${sequence.name}</Name></Sequence>`;
    const source = referenceFirstFixture([sequence]).replace('<PremiereData>', '<PremiereData>\n' + decoys);
    expect(inspectPremiereSequenceArchive(source, sequence.name).sequenceUid).toBe(sequence.uid);
  });

  it.each(['different uid', 'same uid'])('rejects duplicate sequence names before inspection or patching: %s', kind => {
    const first = referenceFirstSource.sequences[0]!;
    const other = kind === 'same uid' ? first : { ...referenceFirstSource.sequences[1]!, name: first.name };
    const source = referenceFirstFixture([first, other]);
    expect(() => inspectPremiereSequenceArchive(source, first.name)).toThrow('PROJECT_ARCHIVE_SEQUENCE_NOT_UNIQUE');
    expect(() => patchPremiereSequenceArchive(source, { sequenceName: first.name, expectedSequenceUid: first.uid })).toThrow('PROJECT_ARCHIVE_SEQUENCE_NOT_UNIQUE');
  });

  it('retains the exact expected UID guard and rejects missing materialized definitions', () => {
    const sequence = referenceFirstSource.sequences[0]!;
    expect(() => patchPremiereSequenceArchive(referenceFirstFixture([sequence]), {
      sequenceName: sequence.name, expectedSequenceUid: 'different-sequence',
    })).toThrow('ACTIVE_SEQUENCE_UID_MISMATCH');
    const missing = fixture().replace('ObjectUID="sequence-uid"', 'ObjectURef="sequence-uid"');
    expect(() => inspectPremiereSequenceArchive(missing, 'WORKING__TEST')).toThrow('PROJECT_ARCHIVE_SEQUENCE_NOT_FOUND');
  });
});

function deduplicatedFixture(): string {
  return fixture()
    .replace('<TrackItem Index="0" ObjectRef="3"/>', '<TrackItem Index="0" ObjectRef="3"/><TrackItem Index="1" ObjectRef="5"/>')
    .replace("</PremiereData>", `<CaptionDataClipTrackItem ObjectID="5"><DataClipTrackItem><ClipTrackItem><TrackItem><Start>1262874412800</Start><End>2525748825600</End></TrackItem></ClipTrackItem></DataClipTrackItem><BlockVector><BlockVectorItem Index="0" ObjectRef="6"/></BlockVector></CaptionDataClipTrackItem>
<Block ObjectID="6"><FormattedTextData Encoding="base64" BinaryHash="bbb78cec-ab5f-9f9a-c278-367800000314"/></Block>
</PremiereData>`);
}

function externallyDeduplicatedFixture(): string {
  return fixture().replace("</PremiereData>", `<ExternalCaptionReference ObjectRef="7"/>
<Block ObjectID="7"><FormattedTextData Encoding="base64" BinaryHash="bbb78cec-ab5f-9f9a-c278-367800000314"/></Block>
</PremiereData>`);
}

// Independent table navigation for corruption/preservation fault injection.
function cueLayout(bytes:Buffer){
  const table=(p:number)=>{const v=p-bytes.readInt32LE(p);return {p,v,fields:Array.from({length:(bytes.readUInt16LE(v)-4)/2},(_,i)=>bytes.readUInt16LE(v+4+2*i))};};
  const pointer=(t:ReturnType<typeof table>,i:number)=>{const p=t.p+t.fields[i]!;return p+bytes.readUInt32LE(p);};
  const root=table(12+bytes.readUInt32LE(12)),document=table(pointer(root,0)),vector=pointer(document,0),run=table(vector+4+bytes.readUInt32LE(vector+4)),style=table(pointer(run,1));
  return {document,vector,run,style,table,pointer};
}
const cueStyleTarget=(items:any[])=>({trackUid:'c1',expectedTrackId:6,expectedTrackName:'CAPTION',expectedItemCount:2,items});
function mixedSharedFixture(){
  const empty=track('CaptionDataClipTrack','c0',5,0,'',[],`<CaptionDataTemplateStyle Encoding="base64" BinaryHash="old-empty">${captionStyle}</CaptionDataTemplateStyle>`);
  const populated=track('CaptionDataClipTrack','c0',5,0,'',["7"],`<CaptionDataTemplateStyle Encoding="base64" BinaryHash="old-empty">${captionStyle}</CaptionDataTemplateStyle>`);
  return deduplicatedFixture().replace(empty,populated).replace('<TrackItem Index="1" ObjectRef="5"/>','<TrackItem Index="1" ObjectRef="5"/><TrackItem Index="2" ObjectRef="10"/>').replace('</PremiereData>',`
  <CaptionDataClipTrackItem ObjectID="7"><Start>0</Start><End>1262874412800</End><BlockVector><BlockVectorItem Index="0" ObjectRef="8"/></BlockVector></CaptionDataClipTrackItem>
  <Block ObjectID="8"><FormattedTextData Encoding="base64" BinaryHash="bbb78cec-ab5f-9f9a-c278-367800000314"/></Block>
  <Sequence ObjectUID="other-sequence"><Name>OTHER</Name><ExternalCaptionReference ObjectRef="9"/></Sequence><Block ObjectID="9"><FormattedTextData Encoding="base64" BinaryHash="bbb78cec-ab5f-9f9a-c278-367800000314"/></Block>
  <CaptionDataClipTrackItem ObjectID="10"><Start>2525748825600</Start><End>3788623238400</End><BlockVector><BlockVectorItem Index="0" ObjectRef="11"/></BlockVector></CaptionDataClipTrackItem>
  <Block ObjectID="11"><FormattedTextData Encoding="base64" BinaryHash="bbb78cec-ab5f-9f9a-c278-367800000314"/></Block></PremiereData>`);
}

describe("Premiere sequence archive editing", () => {
  it('adds a private RGB override without changing the existing document or non-requested style semantics',()=>{
    const before=Buffer.from(captionCue,'base64'),layout=cueLayout(before),snapshot=inspectCaptionCueBinary(captionCue);
    expect(snapshot.fillColor).toBeNull();
    const result=patchCaptionCueBinary(captionCue,{fillColor:{r:11,g:22,b:33}}),after=Buffer.from(result.encoded,'base64');
    expect(result.snapshot).toMatchObject({fillColor:{r:11,g:22,b:33},fontSize:49,fontPostScriptName:snapshot.fontPostScriptName,preservedStyleSha256:snapshot.preservedStyleSha256,text:snapshot.text});
    const permitted=new Set([...Array.from({length:4},(_,i)=>i),...Array.from({length:4},(_,i)=>layout.run.p+layout.run.fields[1]!+i)]);
    expect([...before.keys()].filter(i=>before[i]!==after[i]&&!permitted.has(i))).toEqual([]);
    const next=patchCaptionCueBinary(result.encoded,{fillColor:{r:255,g:0,b:128},fontSize:75,fontPostScriptName:'ArialMT'});
    expect(next.snapshot).toMatchObject({fillColor:{r:255,g:0,b:128},fontSize:75,fontPostScriptName:'ArialMT',preservedStyleSha256:snapshot.preservedStyleSha256,text:snapshot.text});
  });
  it('splits one shared payload into different cue styles while retaining unselected cues, another caption track and external sequence references',()=>{
    const source=mixedSharedFixture(),before=inspectPremiereSequenceArchive(source,'WORKING__TEST');
    const target={...cueStyleTarget([{itemIndex:0,expectedStartTicks:'0',expectedEndTicks:'1262874412800',fontPostScriptName:'ArialMT',fontSize:40,fillColor:{r:12,g:34,b:56}},{itemIndex:1,expectedStartTicks:'1262874412800',expectedEndTicks:'2525748825600',fontPostScriptName:'NotoSansKR-Bold',fontSize:80,fillColor:{r:250,g:120,b:0}}]),expectedItemCount:3};
    const result=patchPremiereSequenceArchive(source,{sequenceName:'WORKING__TEST',expectedSequenceUid:'sequence-uid',captionStyle:target});
    const cues=result.after.tracks.find(t=>t.uid==='c1')!.captionCues!;
    expect(cues.map(c=>c.fontSize)).toEqual([40,80,49]);expect(cues.map(c=>c.fillColor)).toEqual([{r:12,g:34,b:56},{r:250,g:120,b:0},null]);
    expect(cues[2]).toEqual(before.tracks.find(t=>t.uid==='c1')!.captionCues![2]);expect(result.after.tracks.find(t=>t.uid==='c0')).toEqual(before.tracks.find(t=>t.uid==='c0'));
    expect(cues[0]!.preservedStyleSha256).toBe(cues[2]!.preservedStyleSha256);expect(new Set(cues.map(c=>c.binaryHash)).size).toBe(3);
    const external=/<Block ObjectID="9">([\s\S]*?)<\/Block>/.exec(result.xml)![1]!;expect(external).toContain('bbb78cec-ab5f-9f9a-c278-367800000314');
    expect(captionStyleReadbackErrors(before,result.after,target)).toEqual([]);
  });
  it('does not require or create a track template for item-only overrides',()=>{
    const source=deduplicatedFixture().replace(/<CaptionDataTemplateStyle\b[^>]*>[\s\S]*?<\/CaptionDataTemplateStyle>/g,'');
    const result=patchPremiereSequenceArchive(source,{sequenceName:'WORKING__TEST',expectedSequenceUid:'sequence-uid',captionStyle:cueStyleTarget([{itemIndex:1,expectedStartTicks:'1262874412800',expectedEndTicks:'2525748825600',fontSize:60}])});
    expect(result.after.tracks.find(t=>t.uid==='c1')!.style).toBeUndefined();expect(result.after.tracks.find(t=>t.uid==='c1')!.captionCues!.map(c=>c.fontSize)).toEqual([49,60]);
  });
  it('fails post-reopen proof when a selected cue loses unrequested shadow opacity or stroke width',()=>{
    const target={...cueStyleTarget([{itemIndex:0,expectedStartTicks:'0',expectedEndTicks:'1262874412800',fillColor:{r:11,g:22,b:33}}]),expectedItemCount:1};
    const changed=patchPremiereSequenceArchive(fixture(),{sequenceName:'WORKING__TEST',expectedSequenceUid:'sequence-uid',captionStyle:target});
    for(const field of ['opacity','stroke']){
      const match=/<Block ObjectID="4">[\s\S]*?<FormattedTextData\b[^>]*>([^<]+)<\/FormattedTextData>/.exec(changed.xml)!,bytes=Buffer.from(match[1]!,'base64'),layout=cueLayout(bytes);
      const table=field==='opacity'?layout.document:layout.style,slot=field==='opacity'?12:6;bytes.writeFloatLE(73,table.p+table.fields[slot]!);
      const altered=inspectPremiereSequenceArchive(changed.xml.replace(match[1]!,bytes.toString('base64')),'WORKING__TEST');
      expect(altered.tracks.find(t=>t.uid==='c1')!.captionCues![0]!.fillColor).toEqual({r:11,g:22,b:33});
      expect(captionStyleReadbackErrors(changed.before,altered,target)).toContain('CAPTION_UNREQUESTED_STYLE_CHANGED:c1:0');
    }
  });
  it.each(['stale','duplicate','empty','mixed','rgb','unknown'] as const)('rejects an invalid per-cue request before producing an archive: %s',kind=>{
    const item={itemIndex:0,expectedStartTicks:'0',expectedEndTicks:'1262874412800',fontSize:60},target:any=cueStyleTarget([item]);
    if(kind==='stale')item.expectedStartTicks='1';if(kind==='duplicate')target.items.push({...item});if(kind==='empty')delete (item as any).fontSize;if(kind==='mixed')target.fontSize=60;if(kind==='rgb')target.items[0].fillColor={r:256,g:0,b:0};if(kind==='unknown')target.items[0].opacity=30;
    expect(()=>patchPremiereSequenceArchive(deduplicatedFixture(),{sequenceName:'WORKING__TEST',expectedSequenceUid:'sequence-uid',captionStyle:target})).toThrow();
  });
  it('rejects multi-run, malformed-color and unknown-field layouts instead of guessing a write offset',()=>{
    const bytes=Buffer.from(captionCue,'base64'),layout=cueLayout(bytes);bytes.writeUInt32LE(2,layout.vector);expect(()=>inspectCaptionCueBinary(bytes.toString('base64'))).toThrow('MULTIPLE_TEXT_RUNS');
    const colored=patchCaptionCueBinary(captionCue,{fillColor:{r:1,g:2,b:3}}),bad=Buffer.from(colored.encoded,'base64'),parsed=cueLayout(bad),color=parsed.table(parsed.pointer(parsed.style,2));bad.writeUInt16LE(65535,color.v+4);expect(()=>inspectCaptionCueBinary(bad.toString('base64'))).toThrow();
    const unknown=Buffer.from(captionCue,'base64'),known=cueLayout(unknown);unknown.writeUInt16LE(known.style.fields[6]!,known.style.v+4);expect(()=>patchCaptionCueBinary(unknown.toString('base64'),{fontSize:70})).toThrow('UNSUPPORTED');
  });
  it('rejects duplicate materialized payloads for the same binary hash',()=>{
    const source=deduplicatedFixture().replace('<FormattedTextData Encoding="base64" BinaryHash="bbb78cec-ab5f-9f9a-c278-367800000314"/>',`<FormattedTextData Encoding="base64" BinaryHash="bbb78cec-ab5f-9f9a-c278-367800000314">${captionCue}</FormattedTextData>`);
    expect(()=>patchPremiereSequenceArchive(source,{sequenceName:'WORKING__TEST',expectedSequenceUid:'sequence-uid',captionStyle:cueStyleTarget([{itemIndex:0,expectedStartTicks:'0',expectedEndTicks:'1262874412800',fontSize:60}])})).toThrow('PAYLOAD_NOT_UNIQUE');
  });
  it("reads and rewrites the active FlatBuffer font record without recreating captions", () => {
    expect(inspectCaptionStyleBinary(captionStyle)).toMatchObject({
      fontPostScriptName: "LucidaConsole",
      fontSize: 48,
      byteLength: 384,
    });
    const patched = patchCaptionStyleBinary(captionStyle, "NotoSansKR-Medium", 52);
    expect(patched.snapshot).toMatchObject({ fontPostScriptName: "NotoSansKR-Medium", fontSize: 52 });
    expect(patched.snapshot.byteLength).toBeGreaterThan(384);
    expect(inspectCaptionStyleBinary(captionStyle).fontPostScriptName).toBe("LucidaConsole");
  });

  it("reads and rewrites each native caption cue while preserving its text", () => {
    const before = inspectCaptionCueBinary(captionCue, "bbb78cec-ab5f-9f9a-c278-367800000314");
    expect(before).toMatchObject({ fontPostScriptName: "NotoSansKR-Medium", fontSize: 49 });
    expect(before.text).toContain("현대어:");
    expect(before.text).toContain("발음:");
    expect(before.text).toContain("TTS:");
    const patched = patchCaptionCueBinary(captionCue, "NotoSansKR-Medium", 52);
    expect(patched.snapshot).toMatchObject({ fontPostScriptName: "NotoSansKR-Medium", fontSize: 52, text: before.text });
    expect(patched.snapshot.byteLength).toBe(before.byteLength);
    const beforeBytes = Buffer.from(captionCue, "base64");
    const afterBytes = Buffer.from(patched.encoded, "base64");
    expect(afterBytes.reduce((count, byte, index) => count + Number(byte !== beforeBytes[index]), 0)).toBeLessThanOrEqual(8);
    expect(inspectCaptionCueBinary(captionCue).fontSize).toBe(49);
  });

  it("removes only explicitly empty track UIDs and preserves populated items", () => {
    const before = inspectPremiereSequenceArchive(fixture(), "WORKING__TEST");
    const beforeCaption = before.tracks.find((item) => item.uid === "c1");
    expect(beforeCaption?.captionCues).toHaveLength(1);
    expect(beforeCaption?.captionCues?.[0]).toMatchObject({
      index: 0,
      itemObjectId: "3",
      blockObjectId: "4",
      startTicks: "0",
      endTicks: "1262874412800",
      fontPostScriptName: "NotoSansKR-Medium",
      fontSize: 49,
    });
    const result = patchPremiereSequenceArchive(fixture(), {
      sequenceName: "WORKING__TEST",
      expectedSequenceUid: "sequence-uid",
      removeTracks: [
        { mediaType: "video", index: 1, id: 2, uid: "v1", name: "EMPTY_VIDEO", expectedItemCount: 0, expectedTransitionCount: 0 },
        { mediaType: "audio", index: 1, id: 4, uid: "a1", name: "EMPTY_AUDIO", expectedItemCount: 0, expectedTransitionCount: 0 },
        { mediaType: "caption", index: 0, id: 5, uid: "c0", name: "", expectedItemCount: 0, expectedTransitionCount: 0 },
      ],
      captionStyle: {
        trackUid: "c1",
        expectedTrackId: 6,
        expectedTrackName: "CAPTION",
        expectedItemCount: 1,
        fontPostScriptName: "NotoSansKR-Medium",
        fontSize: 52,
      },
    });
    expect(result.after.trackCounts).toEqual({ video: 1, audio: 1, caption: 1 });
    expect(result.after.totalItems).toBe(before.totalItems);
    expect(result.after.tracks.map((item) => item.uid)).toEqual(["v0", "a0", "c1"]);
    expect(result.after.tracks.find((item) => item.uid === "c1")).toMatchObject({
      index: 0,
      itemCount: 1,
      style: { fontPostScriptName: "NotoSansKR-Medium", fontSize: 52 },
      captionCues: [{
        index: 0,
        itemObjectId: "3",
        blockObjectId: "4",
        startTicks: "0",
        endTicks: "1262874412800",
        fontPostScriptName: "NotoSansKR-Medium",
        fontSize: 52,
        text: beforeCaption?.captionCues?.[0]?.text,
      }],
    });
    expect(result.xml).not.toContain('ObjectUID="v1"');
    expect(result.xml).not.toContain('ObjectUID="a1"');
    expect(result.xml).not.toContain('ObjectUID="c0"');
    expect(result.xml).not.toContain('ObjectURef="a1"');
    const retainedCaption = /<CaptionDataClipTrack ObjectUID="c1">[\s\S]*?<\/CaptionDataClipTrack>/.exec(result.xml)?.[0] ?? "";
    expect([...retainedCaption.matchAll(/<Index>(\d+)<\/Index>/g)].map((match) => Number(match[1]))).toEqual([0, 0, 0]);
  });

  it("fails closed unless Track, ClipItems, and TransitionItems all carry the expected index", () => {
    const missingTransitionIndex = fixture().replace(
      /(<CaptionDataClipTrack ObjectUID="c1">[\s\S]*?<TransitionItems>)<Index>1<\/Index>/,
      "$1",
    );
    expect(() => patchPremiereSequenceArchive(missingTransitionIndex, {
      sequenceName: "WORKING__TEST",
      expectedSequenceUid: "sequence-uid",
      removeTracks: [{ mediaType: "caption", index: 0, id: 5, uid: "c0", name: "", expectedItemCount: 0, expectedTransitionCount: 0 }],
    })).toThrow("TRACK_CONTAINER_INDEX_NOT_UNIQUE: c1 TransitionItems");
  });

  it("fails closed when a target is populated or its identity is stale", () => {
    expect(() => patchPremiereSequenceArchive(fixture(), {
      sequenceName: "WORKING__TEST",
      expectedSequenceUid: "sequence-uid",
      removeTracks: [{ mediaType: "video", index: 0, id: 1, uid: "v0", name: "VIDEO", expectedItemCount: 0, expectedTransitionCount: 0 }],
    })).toThrow("TRACK_NOT_EMPTY");
  });

  it("fails closed when a caption block is shared outside the guarded cue", () => {
    const sharedBlock = fixture().replace("</PremiereData>", '<UnexpectedReference ObjectRef="4"/></PremiereData>');
    expect(() => patchPremiereSequenceArchive(sharedBlock, {
      sequenceName: "WORKING__TEST",
      expectedSequenceUid: "sequence-uid",
      captionStyle: {
        trackUid: "c1",
        expectedTrackId: 6,
        expectedTrackName: "CAPTION",
        expectedItemCount: 1,
        fontPostScriptName: "NotoSansKR-Medium",
        fontSize: 52,
      },
    })).toThrow("CAPTION_CUE_BLOCK_REFERENCE_NOT_UNIQUE: 4");
  });

  it("preserves Premiere hash deduplication when multiple cues share one payload", () => {
    const result = patchPremiereSequenceArchive(deduplicatedFixture(), {
      sequenceName: "WORKING__TEST",
      expectedSequenceUid: "sequence-uid",
      captionStyle: {
        trackUid: "c1",
        expectedTrackId: 6,
        expectedTrackName: "CAPTION",
        expectedItemCount: 2,
        fontPostScriptName: "NotoSansKR-Medium",
        fontSize: 52,
      },
    });
    const cues = result.after.tracks.find((track) => track.uid === "c1")?.captionCues ?? [];
    expect(cues).toHaveLength(2);
    expect(cues.map((cue) => cue.text)).toEqual([cues[0]?.text, cues[0]?.text]);
    expect(cues.map((cue) => cue.fontSize)).toEqual([52, 52]);
    expect(new Set(cues.map((cue) => cue.binaryHash)).size).toBe(1);
    const sharedHash = cues[0]!.binaryHash;
    const records = [...result.xml.matchAll(new RegExp(`<FormattedTextData\\b[^>]*BinaryHash="${sharedHash}"[^>]*(?:\\/>|>([\\s\\S]*?)<\\/FormattedTextData>)`, "g"))];
    expect(records).toHaveLength(2);
    expect(records.filter((record) => (record[1] ?? "").trim())).toHaveLength(1);
  });

  it("keeps the original payload available when captions outside the target share its hash", () => {
    const result = patchPremiereSequenceArchive(externallyDeduplicatedFixture(), {
      sequenceName: "WORKING__TEST",
      expectedSequenceUid: "sequence-uid",
      captionStyle: {
        trackUid: "c1",
        expectedTrackId: 6,
        expectedTrackName: "CAPTION",
        expectedItemCount: 1,
        fontPostScriptName: "NotoSansKR-Medium",
        fontSize: 52,
      },
    });
    const externalBlock = /<Block ObjectID="7">[\s\S]*?<FormattedTextData\b[^>]*>([\s\S]*?)<\/FormattedTextData>[\s\S]*?<\/Block>/.exec(result.xml);
    expect(externalBlock?.[1]?.trim()).toBe(captionCue);
    expect(inspectCaptionCueBinary(externalBlock![1]!.trim())).toMatchObject({
      fontPostScriptName: "NotoSansKR-Medium",
      fontSize: 49,
    });
    expect(result.after.tracks.find((track) => track.uid === "c1")?.captionCues?.[0]).toMatchObject({
      fontPostScriptName: "NotoSansKR-Medium",
      fontSize: 52,
    });
  });

  it("keeps the backup and atomically restores it after a failed live reopen", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "premiere-sequence-restore-"));
    const projectPath = path.join(directory, "working.prproj");
    const operationId = "11223344-5566-4788-99aa-bbccddeeff00";
    try {
      const original = fixture();
      await writeFile(projectPath, original, "utf8");
      const committed = await commitPremiereSequenceArchive({
        projectPath,
        sequenceName: "WORKING__TEST",
        expectedSequenceUid: "sequence-uid",
        removeTracks: [{ mediaType: "video", index: 1, id: 2, uid: "v1", name: "EMPTY_VIDEO", expectedItemCount: 0, expectedTransitionCount: 0 }],
      }, operationId);
      expect(await readFile(projectPath, "utf8")).not.toBe(original);
      const restored = await restorePremiereSequenceArchive(projectPath, committed.backupPath, operationId);
      expect(await readFile(projectPath, "utf8")).toBe(original);
      expect(await readFile(committed.backupPath, "utf8")).toBe(original);
      expect(await readFile(restored.failedProjectPath, "utf8")).not.toBe(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
