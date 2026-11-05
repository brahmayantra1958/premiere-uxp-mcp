export type LocatedBlock={block:string;index:number};
export function locateComponent(xml:string,matchName:string):LocatedBlock {
  const matches=[...xml.matchAll(/<VideoFilterComponent\b[^>]*>[\s\S]*?<\/VideoFilterComponent>/g)].filter(m=>m[0].includes(`<MatchName>${matchName}</MatchName>`));
  if(matches.length!==1)throw Error(`PREMIERE_COMPONENT_COUNT_UNEXPECTED: ${matchName}=${matches.length}`);
  return {block:matches[0]![0],index:matches[0]!.index!};
}
export function locateParameter(xml:string,component:LocatedBlock,index:number):LocatedBlock {
  const refs=[...component.block.matchAll(new RegExp(`<Param Index="${index}" ObjectRef="(\\d+)"\\/>`,"g"))];
  if(refs.length!==1)throw Error(`PREMIERE_COMPONENT_PARAMETER_INDEX_UNEXPECTED: ${index}`);
  const matches=[...xml.matchAll(new RegExp(`<([A-Za-z0-9_]+)\\b[^>]*ObjectID="${refs[0]![1]}"[^>]*>[\\s\\S]*?<\\/\\1>`,"g"))];
  if(matches.length!==1)throw Error(`PREMIERE_PARAMETER_OBJECT_NOT_UNIQUE: ${refs[0]![1]}`);
  return {block:matches[0]![0],index:matches[0]!.index!};
}
