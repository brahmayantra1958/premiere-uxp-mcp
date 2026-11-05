import {effectValuesEqual,resolveEffectParameter,type ParameterWrite} from './effect-parameter-contract.js';

type Field='x'|'y'|'red'|'green'|'blue'|'alpha';
type Operand=number|{paramIndex:number;field?:Field}|{nodeIndex:number};
type Point={kind:'point';x:number;y:number};
type Color={kind:'color';red:number;green:number;blue:number;alpha:number};
type Value=number|Point|Color;
type Node={op:'add'|'subtract'|'multiply'|'divide'|'min'|'max'|'point'|'color';args:Operand[]};
export type EffectDependencyGraph={mode?:'observe'|'apply';componentMatchName:string;parameterNames:string[];rules:Array<{id:string;outputParamIndex:number;nodes:Node[]}>};
type Component=Record<string,any>;
type Plan=Array<{snapshot:Record<string,any>;write:ParameterWrite}>;
function typedValue(raw:any,kind?:string):Value {
 if(typeof raw==='number'&&Number.isFinite(raw))return raw;
 if(kind==='point'||raw?.kind==='point'){
  const p=Array.isArray(raw)?raw:[raw?.x,raw?.y];if(p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)))return {kind:'point',x:p[0],y:p[1]};
 }
 if(kind==='color'||raw?.kind==='color'){
  const c=Array.isArray(raw)?raw:[raw?.red,raw?.green,raw?.blue,raw?.alpha];if(c.length===4&&c.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1))return {kind:'color',red:c[0],green:c[1],blue:c[2],alpha:c[3]};
 }
 throw Error('DEPENDENCY_TYPED_VALUE_REQUIRED');
}

/** Pure declaration interpreter, never eval or a host write. Nodes may refer
 * only to earlier nodes; output dependencies form an acyclic graph. Expected
 * values are computed before dispatch and must later match Premiere itself. */
export function deriveDependencyGraph(component:Component,plan:Plan,graph:EffectDependencyGraph,preserveEmptyAnimation=false){
 if(graph.mode!==undefined&&!['observe','apply'].includes(graph.mode))throw Error('DEPENDENCY_MODE_INVALID');
 if(graph.componentMatchName!==component.matchName||graph.parameterNames.length!==component.params.length||graph.parameterNames.some((name,i)=>name!==component.params[i]?.displayName))throw Error('DEPENDENCY_SCHEMA_CHANGED');
 if(!graph.rules.length||graph.rules.length>64)throw Error('DEPENDENCY_RULE_COUNT_INVALID');
 const outputs=new Map<number,typeof graph.rules[number]>(),ids=new Set<string>(),inputs=new Map<number,Set<number>>();
 const index=(v:number)=>{if(!Number.isInteger(v)||v<0||v>=component.params.length)throw Error('DEPENDENCY_PARAMETER_INVALID');return v;};
 for(const rule of graph.rules){
  index(rule.outputParamIndex);
  if(!/^[a-zA-Z0-9_-]{1,96}$/.test(rule.id)||ids.has(rule.id)||outputs.has(rule.outputParamIndex))throw Error('DEPENDENCY_DUPLICATE_RULE');
  if(!Array.isArray(rule.nodes)||!rule.nodes.length||rule.nodes.length>64)throw Error('DEPENDENCY_EXPRESSION_UNBOUNDED');
  const referenced=new Set<number>();
  rule.nodes.forEach((node,i)=>{
   if(!['add','subtract','multiply','divide','min','max','point','color'].includes(node.op)||node.args.length!==(node.op==='color'?4:2))throw Error('DEPENDENCY_OPERATOR_INVALID');
   for(const arg of node.args){
    if(typeof arg==='number'){if(!Number.isFinite(arg))throw Error('DEPENDENCY_CONSTANT_INVALID');}
    else if(arg&&Object.hasOwn(arg,'paramIndex')){
     if(Object.keys(arg).some(k=>!['paramIndex','field'].includes(k))||'field' in arg&&!['x','y','red','green','blue','alpha'].includes(arg.field!))throw Error('DEPENDENCY_FIELD_INVALID');
     referenced.add(index((arg as {paramIndex:number}).paramIndex));
    }
    else if(!arg||Object.keys(arg).length!==1||!Object.hasOwn(arg,'nodeIndex')||!Number.isInteger((arg as {nodeIndex:number}).nodeIndex)||(arg as {nodeIndex:number}).nodeIndex<0||(arg as {nodeIndex:number}).nodeIndex>=i)throw Error('DEPENDENCY_NODE_REFERENCE_INVALID');
   }
  });
  outputs.set(rule.outputParamIndex,rule);ids.add(rule.id);inputs.set(rule.outputParamIndex,referenced);
 }
 const order:number[]=[],visited=new Set<number>(),visiting=new Set<number>();
 const visit=(output:number)=>{
  if(visited.has(output))return;if(visiting.has(output))throw Error('DEPENDENCY_CYCLE');visiting.add(output);
  for(const input of inputs.get(output)!)if(outputs.has(input))visit(input);
  visiting.delete(output);visited.add(output);order.push(output);
 };
 for(const output of outputs.keys())visit(output);
 const values=new Map<number,Value>();
 const numeric=(i:number)=>{
  if(values.has(i))return values.get(i)!;
  const p=resolveEffectParameter(component,{paramIndex:i,expectedDisplayName:graph.parameterNames[i]!});
  if(p.readStatus?.value!=='pass'||p.readStatus?.animation!=='pass'||(p.timeVarying!==false&&!(preserveEmptyAnimation&&p.timeVarying===true))||p.keyframes?.length!==0||p.keyframeDetails?.length!==0)throw Error('DEPENDENCY_STATIC_VALUE_REQUIRED');
  const v=typedValue(p.value,p.descriptor?.inputKind);values.set(i,v);return v;
 };
 const evaluate=(rule:typeof graph.rules[number],state:Map<number,Value>)=>{
  const nodes:Value[]=[];
  for(const node of rule.nodes){
   const args=node.args.map(arg=>{
    if(typeof arg==='number')return arg;
    if('nodeIndex' in arg)return nodes[arg.nodeIndex];
    const v=state.get(arg.paramIndex);if(arg.field){if(!v||typeof v!=='object'||!Object.hasOwn(v,arg.field))throw Error('DEPENDENCY_FIELD_MISMATCH');return (v as any)[arg.field];}return v;
   });
   if(args.some(v=>v===undefined))throw Error('DEPENDENCY_INPUT_MISSING');
   if(args.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('DEPENDENCY_NUMERIC_OPERAND_REQUIRED');
   const [a,b]=args as [number,number,...number[]];
   if(node.op==='point'){nodes.push({kind:'point',x:a!,y:b!});continue;}
   if(node.op==='color'){nodes.push(typedValue({kind:'color',red:a,green:b,blue:args[2],alpha:args[3]}));continue;}
   const value=node.op==='add'?a+b:node.op==='subtract'?a-b:node.op==='multiply'?a*b:node.op==='divide'?a/b:node.op==='min'?Math.min(a,b):Math.max(a,b);
   if(!Number.isFinite(value))throw Error('DEPENDENCY_NONFINITE_RESULT');nodes.push(value);
  }return nodes.at(-1)!;
 };
 for(const output of order){numeric(output);for(const input of inputs.get(output)!)numeric(input);}
 // Observation asserts a pre-existing native relation. Apply declares the
 // relation to establish now, while retaining each freshly inspected output
 // as its optimistic before-value guard.
 if(graph.mode!=='apply')for(const output of order)if(!effectValuesEqual(numeric(output),evaluate(outputs.get(output)!,values)))throw Error('DEPENDENCY_BASELINE_MISMATCH');
 const changed=new Set<number>(),next=new Map(values);
 for(const p of plan){
  const i=Number(p.snapshot.paramIndex);if(outputs.has(i))throw Error('DERIVED_PARAMETER_OVERLAP');
  if(values.has(i)){const v=typedValue(p.write.value,p.snapshot.descriptor?.inputKind);next.set(i,v);if(!effectValuesEqual(values.get(i),v))changed.add(i);}
 }
 const writes:ParameterWrite[]=[],rules:string[]=[];
 for(const output of order){
  if(graph.mode!=='apply'&&![...inputs.get(output)!].some(input=>changed.has(input)))continue;
  const value=evaluate(outputs.get(output)!,next);next.set(output,value);
  if(!effectValuesEqual(value,values.get(output)))changed.add(output);
  writes.push({paramIndex:output,expectedDisplayName:graph.parameterNames[output]!,expectedValue:values.get(output),value});rules.push('declared:'+outputs.get(output)!.id);
 }
 return {writes,rules};
}
