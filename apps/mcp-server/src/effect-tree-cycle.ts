export type NativeDisclosure = {index:number;depth:number;expanded:boolean};
export type NativeDisclosureTree = {complete:boolean;rows:NativeDisclosure[]};
export type EffectTreeServices = {
  inspect:()=>Promise<NativeDisclosureTree>;
  set:(row:NativeDisclosure,expanded:boolean)=>Promise<{status:string;expanded:boolean}>;
  assertTarget:()=>Promise<void>;
  progress:(value:{cycle:number;depth:number;verified:true;controls:number})=>Promise<void>;
};

function validateTree(tree:NativeDisclosureTree):NativeDisclosure[]{
  if(!tree.complete||!Array.isArray(tree.rows)||!tree.rows.length||tree.rows.length>256)throw Error("EFFECT_TREE_OBSERVATION_INCOMPLETE");
  const ids=new Set<number>();let previousDepth=0;
  const rows=[...tree.rows].sort((a,b)=>a.index-b.index);
  for(const row of rows){
    if(!Number.isInteger(row.index)||row.index<0||row.index>2047||ids.has(row.index)||!Number.isInteger(row.depth)||row.depth<0||row.depth>8||row.depth>previousDepth+1||typeof row.expanded!=="boolean")throw Error("EFFECT_TREE_LAYOUT_UNVERIFIED");
    ids.add(row.index);previousDepth=row.depth;
  }
  if(rows[0]!.depth!==0)throw Error("EFFECT_TREE_ROOT_MISSING");return rows;
}

/** Own a single bounded request. Only complete native observations count;
 * failed/unknown writes are never toggled a second time. The initial expansion
 * discovers rendered children, then collapse is deepest-first and reopening is
 * breadth-first. Hidden model-only controls are not invented as UI controls.
 */
export async function cycleEffectTree(cycles:number,services:EffectTreeServices){
  if(!Number.isInteger(cycles)||cycles<1||cycles>5)throw Error("EFFECT_TREE_CYCLES_INVALID");
  let actions=0;
  const inspect=async()=>{await services.assertTarget();return validateTree(await services.inspect());};
  const set=async(row:NativeDisclosure,expanded:boolean)=>{
    if(++actions>3000)throw Error("EFFECT_TREE_ACTION_BUDGET");
    await services.assertTarget();const result=await services.set(row,expanded);await services.assertTarget();
    if(result.status!=="pass"||result.expanded!==expanded)throw Error("EFFECT_TREE_ACTION_UNVERIFIED_NO_REPLAY");
  };
  let inventory:NativeDisclosure[]=[];
  for(let attempt=0;attempt<=256;attempt++){
    const rows=await inspect(),closed=rows.filter(r=>!r.expanded).sort((a,b)=>a.depth-b.depth||a.index-b.index);
    if(!closed.length){inventory=rows;break;}
    if(attempt===256)throw Error("EFFECT_TREE_DISCOVERY_UNBOUNDED");
    // Only already observed controls at this shallowest depth are touched;
    // newly revealed descendants are discovered in the next native sweep.
    const depth=closed[0]!.depth;for(const row of closed.filter(r=>r.depth===depth))await set(row,true);
  }
  const maxDepth=Math.max(...inventory.map(r=>r.depth));
  const parents=new Map<number,number|undefined>(),stack:NativeDisclosure[]=[];
  for(const row of inventory){while(stack.length&&stack.at(-1)!.depth>=row.depth)stack.pop();parents.set(row.index,stack.at(-1)?.index);stack.push(row);}
  const expected=(depth:number)=>inventory.filter(row=>{const parent=parents.get(row.index);return parent===undefined||inventory.find(r=>r.index===parent)!.depth<=depth;});
  const verify=async(depth:number)=>{
    const actual=await inspect(),wanted=expected(depth);
    if(actual.length!==wanted.length||actual.some((r,i)=>r.index!==wanted[i]!.index||r.depth!==wanted[i]!.depth||r.expanded!==(r.depth<=depth)))throw Error("EFFECT_TREE_PHASE_UNVERIFIED");
    return actual.length;
  };
  for(let cycle=1;cycle<=cycles;cycle++){
    for(const row of [...inventory].sort((a,b)=>b.depth-a.depth||b.index-a.index))await set(row,false);
    await services.progress({cycle,depth:-1,verified:true,controls:await verify(-1)});
    for(let depth=0;depth<=maxDepth;depth++){
      for(const row of inventory.filter(r=>r.depth===depth))await set(row,true);
      await services.progress({cycle,depth,verified:true,controls:await verify(depth)});
    }
  }
  return {status:"pass" as const,completedCycles:cycles,controls:inventory.length,maxDepth,actions};
}
