import { componentSnapshot, GraphicObjectUnavailableError, type ComponentReadProjection } from './host-components.js';
import { settledGraphicRead } from './graphic-lifecycle.js';
import { readNativeObject } from './native-object-read.js';
import { text, type AnyRecord } from './host-foundation.js';
import { observeHostAwait, type HostCommandProgress } from './host-command-progress.js';
import { equalSnapshotValue } from './snapshot-equality.js';

type GraphicEntry = { raw: any; snapshot: AnyRecord };
type ReacquireGraphic = () => Promise<GraphicEntry>;
export type EffectStructure = Readonly<{ snapshot: AnyRecord; components: ReadonlyArray<readonly [string,number]> }>;

function identity(entry: GraphicEntry): string {
  const s=entry.snapshot;
  return JSON.stringify([s.id,s.name,s.projectItemId,s.mediaType,s.trackIndex,s.start?.ticks,s.end?.ticks,s.inPoint?.ticks,s.outPoint?.ticks]);
}

/** Probe topology without value/animation promises. Native graphics can publish
 * an item before their children and source bounds finish reconstructing. Each
 * async component name gets a fresh binding; only plain proof crosses awaits.
 * Repeated equality is a readiness guard, not an atomic Adobe lifetime lock. */
async function readStructure(reacquire: ReacquireGraphic, progress?: HostCommandProgress, requiredMatchName?: string, fullTarget=false): Promise<EffectStructure & {identity:string}> {
  const first=await reacquire(), expectedIdentity=identity(first);
  // UI boundaries compare complete target metadata, including source mapping.
  // Detach the baseline so a mutable callback result cannot hide later drift.
  const snapshot=fullTarget?JSON.parse(JSON.stringify(first.snapshot)):first.snapshot;
  const targetMatches=(entry:GraphicEntry)=>fullTarget?equalSnapshotValue(snapshot,entry.snapshot):identity(entry)===expectedIdentity;
  const acquire=async()=>{
    const entry=await reacquire();
    if(!targetMatches(entry))throw new GraphicObjectUnavailableError('graphic bounds changed during topology probe');
    const chain:any=await readNativeObject(()=>observeHostAwait(progress,'getComponentChain',()=>entry.raw.getComponentChain()));
    if(!chain)throw new GraphicObjectUnavailableError('graphic chain unavailable');
    return chain;
  };
  const chain=await acquire(), count=Number(chain.getComponentCount());
  if(!Number.isInteger(count)||count<1)throw new GraphicObjectUnavailableError('graphic chain is not populated');
  const components:Array<[string,number]>=[];
  for(let index=0;index<count;index++){
    const current=await acquire();
    if(Number(current.getComponentCount())!==count)throw new GraphicObjectUnavailableError('graphic component count changed');
    const component=current.getComponentAtIndex(index);
    if(!component)throw new GraphicObjectUnavailableError(`graphic component ${index} unavailable`);
    const paramCount=Number(component.getParamCount());
    if(!Number.isInteger(paramCount)||paramCount<0)throw new GraphicObjectUnavailableError('graphic parameter count unreadable');
    const matchName=text(await observeHostAwait(progress,'getMatchName',()=>component.getMatchName(),{componentIndex:index}));
    if(!matchName)throw new GraphicObjectUnavailableError('graphic component identity unreadable');
    components.push([matchName,paramCount]);
  }
  if(!targetMatches(await reacquire()))throw new GraphicObjectUnavailableError('graphic bounds changed after topology probe');
  if(requiredMatchName&&!components.some(([name])=>name===requiredMatchName))throw new GraphicObjectUnavailableError(`graphic child ${requiredMatchName} is not populated`);
  return {snapshot,components,identity:expectedIdentity};
}

/** UI identity boundary only: fresh complete target metadata and ordered native
 * topology, without values or animation. It does not establish content preservation
 * or readiness for value reads; callers still need their final full native proof. */
export async function readEffectStructure(reacquire: ReacquireGraphic, progress?: HostCommandProgress): Promise<EffectStructure> {
  const {snapshot,components}=await readStructure(reacquire,progress,undefined,true);
  return {snapshot,components};
}

/** Pure topology comparison against a complete public component snapshot. */
export function effectStructureMatches(before: readonly AnyRecord[], current: EffectStructure): boolean {
  return before.length===current.components.length&&before.every((component,index)=>
    component.componentIndex===index&&component.matchName===current.components[index]![0]
    &&Array.isArray(component.params)&&component.params.length===current.components[index]![1]
    &&component.params.every((param:AnyRecord,paramIndex:number)=>param.paramIndex===paramIndex));
}

async function graphicStructure(reacquire: ReacquireGraphic, progress?: HostCommandProgress, requiredMatchName?: string): Promise<string> {
  const structure=await readStructure(reacquire,progress,requiredMatchName);
  return JSON.stringify([structure.identity,structure.components]);
}

export function graphicComponentSnapshot(reacquire: ReacquireGraphic, strict=false, sampleTime?: any, projection?: ComponentReadProjection, progress?: HostCommandProgress, requiredMatchName?: string): Promise<AnyRecord[]> {
  return settledGraphicRead(
    ()=>graphicStructure(reacquire,progress,requiredMatchName),
    ()=>componentSnapshot(undefined,strict,false,sampleTime,projection,progress,async()=>(await reacquire()).raw),
  );
}
