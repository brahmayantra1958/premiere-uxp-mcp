import type { ProjectSnapshot } from "@premiere-uxp/contracts";
import type { RemoveTrackTarget, SequenceArchiveSnapshot } from "./premiere-sequence-archive.js";

type Row = Record<string, any>;
type Media = 'video' | 'audio' | 'caption';
const mediaTypes: Media[] = ['video', 'audio', 'caption'];
const ticks = (time: Row | undefined) => time?.ticks;
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row)
    ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) : row);
}
function indexRemap(removals: RemoveTrackTarget[]) {
  const seen = new Set<string>();
  for (const row of removals) {
    const key = `${row.mediaType}:${row.index}`;
    if (seen.has(key)) throw Error('TRACK_REMOVAL_DUPLICATE_TARGET');
    seen.add(key);
  }
  return (media: Media, index: number): number | undefined => {
    if (!Number.isInteger(index) || index < 0) throw Error('TRACK_REMOVAL_INVALID_INDEX');
    if (seen.has(`${media}:${index}`)) return undefined;
    return index - removals.filter(row => row.mediaType === media && row.index < index).length;
  };
}

/** Plain content proof only. Wrapper/serialized ObjectIDs are not persistent
 * identities; each source is correlated with the independently read project
 * snapshot before its exact ranges and effects are compared. */
export function trackRemovalHostPreservation(sequence: Row, project: ProjectSnapshot, removals: RemoveTrackTarget[]): string {
  const invalid = (why: string): never => { throw Error(`TRACK_REMOVAL_HOST_PROOF_INCOMPLETE: ${why}`); };
  // Reuse the native-graphic exact-slot and component-chain identity contract.
  captionStyleAvPreservation(sequence, project);
  const active = project.activeSequence;
  if (!active || active.itemsTruncated !== false || active.id !== sequence.id || active.name !== sequence.name) invalid('active sequence');
  const remap = indexRemap(removals);
  const rows = [...sequence.tracks, ...sequence.captionTrackStates.map((row: Row) => ({ ...row, mediaType: 'caption' }))] as Row[];
  for (const media of mediaTypes) {
    const same = rows.filter(row => row.mediaType === media);
    if (same.length !== sequence[`${media}Tracks`] || same.some((row, index) => row.index !== index || typeof row.muted !== 'boolean')) invalid(`${media} track inventory`);
  }
  for (const target of removals) {
    const row = rows.find(row => row.mediaType === target.mediaType && row.index === target.index);
    if (!row || row.id !== target.id || row.itemCount !== 0 || row.transitionCount !== 0) invalid('removed track is not exact and empty');
  }
  const trackRows = (all: Row[]) => all.map(row => ({ mediaType: row.mediaType, index: row.index, id: row.id, name: row.name, muted: row.muted, itemCount: row.itemCount, transitionCount: row.transitionCount }));
  const activeRows = [...active!.tracks, ...active!.captionTrackStates.map(row => ({ ...row, mediaType: 'caption' }))];
  if (stable(trackRows(rows)) !== stable(trackRows(activeRows))) invalid('project/sequence track race');
  const itemProjection = (item: Row, index = item.trackIndex) => ({
    name: item.name, projectItemId: item.projectItemId, mediaType: item.mediaType, trackIndex: index,
    start: ticks(item.start), end: ticks(item.end), inPoint: ticks(item.inPoint), outPoint: ticks(item.outPoint),
    speed: item.speed, reversed: item.reversed, disabled: item.disabled, adjustmentLayer: item.adjustmentLayer,
  });
  if (active!.items.length !== sequence.items.length || project.effects.length !== sequence.items.length) invalid('item/effect inventory');
  const ids = new Set<string>(), slots = new Set<string>();
  const items = sequence.items.map((item: Row) => {
    const slot = `${item.mediaType}:${item.trackIndex}:${ticks(item.start)}`;
    if (!item.id || ids.has(item.id) || slots.has(slot)) invalid('ambiguous item');
    ids.add(item.id); slots.add(slot);
    if (!['video', 'audio'].includes(item.mediaType) || ![item.start, item.end, item.inPoint, item.outPoint].every(time => typeof ticks(time) === 'string' && /^-?\d+$/.test(ticks(time)))
      || !Number.isFinite(item.speed) || ![item.reversed, item.disabled, item.adjustmentLayer].every(flag => typeof flag === 'boolean')) invalid('item metadata');
    const index = remap(item.mediaType, item.trackIndex);
    if (index === undefined) invalid('item on removed track');
    const peer = active!.items.filter(row => row.id === item.id);
    if (peer.length !== 1 || stable(itemProjection(peer[0]!)) !== stable(itemProjection(item))) invalid('project/sequence item race');
    const effects = (project.effects as Row[]).filter(row => row.trackItemId === item.id);
    if (effects.length !== 1 || effects[0]!.name !== item.name || effects[0]!.mediaType !== item.mediaType || !Array.isArray(effects[0]!.components)) invalid('effect identity');
    const chain = effects[0]!.components.map((component: Row, componentIndex: number) => {
      if (component.componentIndex !== componentIndex || !component.matchName || !Array.isArray(component.params)) invalid('component coverage');
      const params = component.params.map((param: Row, paramIndex: number) => {
        if (param.paramIndex !== paramIndex || !Array.isArray(param.keyframes) || !Array.isArray(param.keyframeDetails)
          || param.keyframes.length !== param.keyframeDetails.length || param.readStatus?.animation !== 'pass'
          || !['pass', 'unsupported'].includes(param.readStatus?.value)) invalid('parameter readback');
        // These fields label the same observation; all native content, sample
        // ticks, coverage and errors remain. Never substitute an absent value.
        const { descriptor, displayName, sampledSequenceTime, timeMapping, ...content } = param;
        void displayName; void sampledSequenceTime; void timeMapping;
        return { ...content, ...(descriptor?.semanticRole === 'host_status' ? { value: undefined } : {}) };
      });
      return { matchName: component.matchName, params, readbackCoverage: component.readbackCoverage };
    });
    const nativeGraphic = item.projectItemId === '';
    return stable({ ...itemProjection(item, index), components: nativeGraphic ? chain.filter((row: Row) => row.matchName !== GRAPHIC_GROUP) : chain,
      ...(nativeGraphic ? { graphicGroups: chain.filter((row: Row) => row.matchName === GRAPHIC_GROUP) } : {}) });
  }).sort();
  for (const media of ['video', 'audio']) {
    if (rows.filter(row => row.mediaType === media).reduce((sum, row) => sum + row.itemCount, 0) !== sequence.items.filter((item: Row) => item.mediaType === media).length) invalid('track item counts');
  }
  if (!Array.isArray(sequence.transitions) || rows.filter(row => row.mediaType === 'video').reduce((sum, row) => sum + row.transitionCount, 0) !== sequence.transitions.length) invalid('video transition coverage');
  const transition = (row: Row, index = row.trackIndex) => ({ trackIndex: index, name: row.name, matchName: row.matchName, start: ticks(row.start), end: ticks(row.end), duration: ticks(row.duration) });
  if (stable(sequence.transitions.map((row: Row) => transition(row)).sort((a: Row, b: Row) => stable(a).localeCompare(stable(b)))) !== stable(active!.transitions.map(row => transition(row)).sort((a, b) => stable(a).localeCompare(stable(b))))) invalid('project/sequence transition race');
  const transitions = sequence.transitions.map((row: Row) => {
    const index = remap('video', row.trackIndex);
    if (index === undefined || !row.matchName || ![row.start, row.end, row.duration].every(time => typeof ticks(time) === 'string')) invalid('transition metadata');
    return stable(transition(row, index));
  }).sort();
  return stable({ id: sequence.id, name: sequence.name, width: sequence.width, height: sequence.height, frameRate: sequence.frameRate, duration: ticks(sequence.duration),
    tracks: trackRows(rows.flatMap(row => { const index = remap(row.mediaType, row.index); return index === undefined ? [] : [{ ...row, index }]; })), items, transitions,
    markers: project.markers, offlineMediaIds: [...project.offlineMediaIds].sort(), proxyAttachments: project.proxyAttachments });
}

/** Complete retained caption payload semantics and bytes are invariant during
 * track removal. Ignore only serialized ObjectIDs and Adobe's BinaryHash token;
 * SHA-256 of actual bytes, decoded text/styles and track UID remain evidence. */
export function trackRemovalArchivePreservation(archive: SequenceArchiveSnapshot, removals: RemoveTrackTarget[]): string {
  const remap = indexRemap(removals);
  const tracks = archive.tracks.flatMap(row => {
    const index = remap(row.mediaType, row.index);
    if (index === undefined) {
      if (!row.empty || row.itemCount !== 0 || row.transitionCount !== 0) throw Error('TRACK_REMOVAL_ARCHIVE_NOT_EMPTY');
      return [];
    }
    const styleContent = (style: Row) => {
      const { binaryHash, ...content } = style; void binaryHash;
      if (typeof content.contentSha256 !== 'string' || !content.contentSha256) throw Error('TRACK_REMOVAL_CAPTION_CONTENT_PROOF_INCOMPLETE');
      return content;
    };
    if (row.mediaType === 'caption' && (!row.captionCues || row.captionCues.length !== row.itemCount)) throw Error('TRACK_REMOVAL_CAPTION_PROOF_INCOMPLETE');
    return [{ ...row, index, ...(row.style ? { style: styleContent(row.style) } : {}),
      ...(row.captionCues ? { captionCues: row.captionCues.map(cue => {
        const { itemObjectId, blockObjectId, ...content } = cue; void itemObjectId; void blockObjectId;
        if (!cue.preservedStyleSha256) throw Error('TRACK_REMOVAL_CAPTION_STYLE_PROOF_INCOMPLETE');
        return styleContent(content);
      }) } : {}) }];
  });
  return stable({ sequenceUid: archive.sequenceUid, sequenceName: archive.sequenceName, totalItems: archive.totalItems, tracks });
}

function captionAvTuple(item:Record<string,any>):unknown[]{
  return [item.projectItemId,item.mediaType,item.trackIndex,item.start?.ticks,item.end?.ticks,item.inPoint?.ticks,item.outPoint?.ticks,item.speed,item.reversed,item.disabled,item.adjustmentLayer];
}

const GRAPHIC_GROUP='AE.ADBE Graphic Group';

/** A native graphic can have no ProjectItem. Correlate its current unique slot
 * with the independently read project snapshot and retain the ordered chain.
 * Premiere does not store the Graphic Group slot: a reopened project re-creates
 * it right after Motion, so an in-session [..effects, Graphic Group, Text] reads
 * back as [Graphic Group, ..effects, Text] with identical rendering (2026-11-03
 * live: 107 graphics; the archive has no Graphic Group matchName). Its count is
 * compared separately; every stored component keeps its order.
 * This proves timeline/chain preservation, not opaque Source Text or pixels. */
function captionGraphicIdentity(item:Record<string,any>,sequence:Record<string,any>,project?:ProjectSnapshot):unknown{
  const incomplete=()=>{throw Error('CAPTION_GRAPHIC_PROOF_INCOMPLETE');};
  const ticks=(value:unknown)=>typeof value==='string'&&/^-?\d+$/.test(value);
  if(item.projectItemId!==''||item.mediaType!=='video'||typeof item.id!=='string'||!item.id||typeof item.name!=='string'||!item.name
    ||![item.start?.ticks,item.end?.ticks,item.inPoint?.ticks,item.outPoint?.ticks].every(ticks)||!Number.isFinite(item.speed)
    ||![item.reversed,item.disabled,item.adjustmentLayer].every(value=>typeof value==='boolean'))return incomplete();
  const active=project?.activeSequence;
  if(!active||active.id!==sequence.id||active.name!==sequence.name||active.itemsTruncated!==false)return incomplete();
  const own=sequence.items.filter((candidate:any)=>candidate.id===item.id);
  const peers=active.items.filter((candidate:any)=>candidate.id===item.id);
  const sameSlot=(candidate:Record<string,any>)=>candidate.mediaType===item.mediaType&&candidate.trackIndex===item.trackIndex&&candidate.start?.ticks===item.start.ticks;
  if(sequence.items.filter(sameSlot).length!==1||active.items.filter(sameSlot).length!==1)return incomplete();
  if(own.length!==1||peers.length!==1||peers[0]?.name!==item.name||JSON.stringify(captionAvTuple(peers[0]!))!==JSON.stringify(captionAvTuple(item)))return incomplete();
  const rows=(project.effects as Record<string,any>[]).filter(row=>row.trackItemId===item.id);
  if(rows.length!==1||rows[0]!.name!==item.name||rows[0]!.mediaType!==item.mediaType||!Array.isArray(rows[0]!.components)||!rows[0]!.components.length)return incomplete();
  const chain=rows[0]!.components.map((component:Record<string,any>,index:number)=>{
    if(component.componentIndex!==index||typeof component.matchName!=='string'||!component.matchName)return incomplete();
    return component.matchName;
  });
  if(!chain.some((matchName:string)=>[GRAPHIC_GROUP,'AE.ADBE Text','AE.ADBE Shape'].includes(matchName)))return incomplete();
  const groups=chain.filter((matchName:string)=>matchName===GRAPHIC_GROUP).length;
  if(groups>1)return incomplete();
  return ['native_graphic',item.name,groups,chain.filter((matchName:string)=>matchName!==GRAPHIC_GROUP)];
}

export function captionStyleAvPreservation(sequence:Record<string,any>,project?:ProjectSnapshot):string{
  if(sequence.itemsTruncated!==false)throw Error('CAPTION_AV_PROOF_TRUNCATED');
  const items=sequence.items.map((item:any)=>{
    if(!['video','audio'].includes(item.mediaType)||!Number.isInteger(item.trackIndex)||item.trackIndex<0||typeof item.start?.ticks!=='string'||typeof item.end?.ticks!=='string')throw Error('CAPTION_AV_PROOF_INCOMPLETE');
    // Compare source/timeline identity, not temporary archive ObjectIDs or wrapper IDs.
    // Source getId/guid is the same identity used by the existing timeline contract.
    const identity=typeof item.projectItemId==='string'&&item.projectItemId?['project_item',item.projectItemId]:captionGraphicIdentity(item,sequence,project);
    return JSON.stringify([identity,...captionAvTuple(item)]);
  }).sort();
  return JSON.stringify({id:sequence.id,videoTracks:sequence.videoTracks,audioTracks:sequence.audioTracks,items,tracks:sequence.tracks,captionTrackStates:sequence.captionTrackStates,transitions:sequence.transitions});
}

