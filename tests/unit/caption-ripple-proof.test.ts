import {expect,it} from 'vitest';
import {prepareCaptionProof,verifyCaptionProof} from '../../apps/mcp-server/src/caption-ripple-proof.js';
import {captionRippleWorkload} from '../fixtures/caption-ripple-workload.js';

const tolerance=254016n;
const shift=(ticks:string,delta:bigint)=>String(BigInt(ticks)+delta);

it('keeps input order untouched while correlating reordered tracks and cues by timing',()=>{
  const {before,after,plan}=captionRippleWorkload(32,2);
  before.tracks.reverse();after.tracks.reverse();plan.changes.reverse();
  before.tracks.forEach(t=>t.captionCues!.reverse());after.tracks.forEach(t=>t.captionCues!.reverse());
  const frozen=JSON.stringify({before,after,plan});
  const proof=prepareCaptionProof(before,plan);
  expect(verifyCaptionProof(after,proof)).toEqual([]);
  expect(JSON.stringify({before,after,plan})).toBe(frozen);
});

it.each([-1n,1n])('preserves the inclusive one-microsecond timing tolerance (%s)',direction=>{
  const {before,after,plan}=captionRippleWorkload(12);
  const cue=before.tracks[0]!.captionCues![10]!,saved=after.tracks[0]!.captionCues![10]!;
  cue.startTicks=shift(cue.startTicks,direction*tolerance);
  cue.endTicks=shift(cue.endTicks,direction*tolerance);
  saved.startTicks=shift(saved.startTicks,direction*tolerance);
  saved.endTicks=shift(saved.endTicks,direction*tolerance);
  const proof=prepareCaptionProof(before,plan);
  expect(verifyCaptionProof(after,proof)).toEqual([]);
  saved.endTicks=shift(saved.endTicks,direction);
  expect(verifyCaptionProof(after,proof)).toEqual(['Caption timing differs: caption:0:10']);
  cue.startTicks=shift(cue.startTicks,direction);
  expect(()=>prepareCaptionProof(before,plan)).toThrow('RIPPLE_CAPTION_ARCHIVE_BASELINE_MISMATCH: caption:0:10');
});

it('rejects two matching cues within tolerance without guessing from ObjectID',()=>{
  const {before,plan}=captionRippleWorkload(12),track=before.tracks[0]!,cue=track.captionCues![10]!;
  track.captionCues!.push({...cue,itemObjectId:'different',startTicks:shift(cue.startTicks,1n)});
  expect(()=>prepareCaptionProof(before,plan)).toThrow('RIPPLE_CAPTION_ARCHIVE_BASELINE_MISMATCH: caption:0:10');
});

it('distinguishes equal-start cues with different ends and verifies end-time ordering',()=>{
  const {before,after,plan}=captionRippleWorkload(12);
  const cue=before.tracks[0]!.captionCues![10]!,saved=after.tracks[0]!.captionCues![10]!;
  const extra={...cue,itemObjectId:'same-start',endTicks:shift(cue.endTicks,-tolerance*3n),text:'other',contentSha256:'other'};
  before.tracks[0]!.captionCues!.push(extra);
  after.tracks[0]!.captionCues!.push({...extra,startTicks:saved.startTicks,endTicks:shift(saved.endTicks,-tolerance*3n)});
  const change=plan.changes[0]!;
  plan.changes.push({...change,id:'caption:0:extra',endTicks:extra.endTicks,pieces:[{
    ...change.pieces[0]!,originalEndTicks:extra.endTicks,endTicks:shift(change.pieces[0]!.endTicks,-tolerance*3n),
  }]});
  expect(verifyCaptionProof(after,prepareCaptionProof(before,plan))).toEqual([]);
});

it.each(['changed-hash','track-hash','unchanged-hash','unchanged-duplicate'] as const)('preserves baseline failure classification: %s',fault=>{
  const {before,plan}=captionRippleWorkload(12),track=before.tracks[0]!;
  if(fault==='changed-hash')delete track.captionCues![10]!.contentSha256;
  if(fault==='track-hash')delete track.style!.contentSha256;
  if(fault==='unchanged-hash')delete track.captionCues![0]!.contentSha256;
  if(fault==='unchanged-duplicate')track.captionCues!.push({...track.captionCues![0]!});
  expect(()=>prepareCaptionProof(before,plan)).toThrow(fault.startsWith('unchanged')?'RIPPLE_CAPTION_ORDER_AMBIGUOUS':'RIPPLE_CAPTION_BYTES_UNVERIFIED');
});

it.each(['missing','index','uid','duplicate','count','unchanged-time','unchanged-text','style'] as const)('retains whole-track readback guards: %s',fault=>{
  const {before,after,plan}=captionRippleWorkload(12),proof=prepareCaptionProof(before,plan),track=after.tracks[0]!;
  if(fault==='missing')after.tracks=[];
  if(fault==='index')track.index++;
  if(fault==='uid')track.uid='other';
  if(fault==='duplicate')after.tracks.push(structuredClone(track));
  if(fault==='count')track.captionCues!.pop();
  if(fault==='unchanged-time')track.captionCues![0]!.endTicks=shift(track.captionCues![0]!.endTicks,tolerance+1n);
  if(fault==='unchanged-text')track.captionCues![0]!.text='different';
  if(fault==='style')track.style!.contentSha256='different';
  const errors=verifyCaptionProof(after,proof);
  if(['missing','index','uid','duplicate'].includes(fault))expect(errors).toEqual(['Caption track identity changed: caption:0:10']);
  else if(fault==='count')expect(errors).toEqual(['Caption count differs: caption:0:10']);
  else if(fault==='unchanged-time')expect(errors).toEqual(['Caption timing differs: caption:0:0']);
  else if(fault==='unchanged-text')expect(errors).toEqual(['Caption text/style differs: caption:0:0']);
  else expect(errors).toHaveLength(12);
});

it('does not invent caption work when the plan has no caption changes',()=>{
  const {before,after,plan}=captionRippleWorkload(12);
  plan.changes=[];delete before.tracks[0]!.captionCues;
  expect(prepareCaptionProof(before,plan)).toEqual([]);
  expect(verifyCaptionProof(after,[])).toEqual([]);
});

it('keeps diagnostics in first-affected-track then cue-time order',()=>{
  const {before,after,plan}=captionRippleWorkload(12,2);
  plan.changes.reverse();
  after.tracks[1]!.captionCues![0]!.text='first track error';
  after.tracks[0]!.captionCues![11]!.endTicks=shift(after.tracks[0]!.captionCues![11]!.endTicks,tolerance+1n);
  expect(verifyCaptionProof(after,prepareCaptionProof(before,plan))).toEqual([
    'Caption text/style differs: caption:1:0','Caption timing differs: caption:0:11',
  ]);
});

it('uses integer tick comparisons beyond Number safe integer precision',()=>{
  const {before,after,plan}=captionRippleWorkload(12),offset=10n**22n;
  for(const snapshot of [before,after])for(const track of snapshot.tracks)for(const cue of track.captionCues!){
    cue.startTicks=shift(cue.startTicks,offset);cue.endTicks=shift(cue.endTicks,offset);
  }
  for(const change of plan.changes){
    change.startTicks=shift(change.startTicks,offset);change.endTicks=shift(change.endTicks,offset);
    for(const piece of change.pieces){
      piece.startTicks=shift(piece.startTicks,offset);piece.endTicks=shift(piece.endTicks,offset);
    }
  }
  const proof=prepareCaptionProof(before,plan);
  expect(verifyCaptionProof(after,proof)).toEqual([]);
  after.tracks[0]!.captionCues![10]!.endTicks=shift(after.tracks[0]!.captionCues![10]!.endTicks,tolerance+1n);
  expect(verifyCaptionProof(after,proof)).toEqual(['Caption timing differs: caption:0:10']);
});

it('accepts an absent optional track style while still proving every cue hash',()=>{
  const {before,after,plan}=captionRippleWorkload(12);
  delete before.tracks[0]!.style;delete after.tracks[0]!.style;
  const proof=prepareCaptionProof(before,plan);
  expect(verifyCaptionProof(after,proof)).toEqual([]);
  after.tracks[0]!.captionCues![0]!.contentSha256='changed';
  expect(verifyCaptionProof(after,proof)).toEqual(['Caption text/style differs: caption:0:0']);
});
