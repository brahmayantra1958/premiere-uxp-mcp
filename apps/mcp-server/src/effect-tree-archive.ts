import {createHash} from "node:crypto";
import {resolveNativeVideoClip,type MaskArchiveTarget} from "./premiere-mask-archive.js";

export type DisclosureNode={id:string;parentId?:string;depth:number;kind:"effect"|"group"|"parameter";name:string;key:string;objectId:string};
const allowedKeys=["ECP.Filter.Expanded","ECP.Slider.Expanded","ECP.Angle.Expanded","ECP.PointParameter.Expanded","ECP.Group.Expanded"] as const;
const escaped=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const text=(b:string,k:string)=>new RegExp(`<${k}>([^<]*)</${k}>`).exec(b)?.[1]??"";
/** UI-only metadata. Never touches media, keyframes, filter private data or masks. */
export function withoutDisclosureProperties(block:string):string{
 for(const key of allowedKeys)block=block.replace(new RegExp(`<${escaped(key)}>(?:true|false)</${escaped(key)}>`,'g'),"");
 return block.replace(/<Properties Version="1">\s*<\/Properties>/g,"").replace(/<Node Version="1">\s*<\/Node>/g,"").replace(/>\s+</g,"><");
}
export function effectTreeArchive(xml:string,target:MaskArchiveTarget){
 // Reuse the native archive's exact sequence/track/source/bounds validation.
 const clip=resolveNativeVideoClip(xml,target);
 const matches=[...xml.matchAll(/<([A-Za-z0-9_]+)\b[^>]*ObjectID="(\d+)"[^>]*>[\s\S]*?<\/\1>/g)];
 const objects=new Map<string,string>();for(const m of matches){if(objects.has(m[2]!))throw Error("EFFECT_TREE_DUPLICATE_OBJECT");objects.set(m[2]!,m[0]);}
 const object=(id:string)=>{const b=objects.get(id);if(!b)throw Error("EFFECT_TREE_OBJECT_MISSING");return b;};
 const nodes:DisclosureNode[]=[],visited=new Set<string>();
 const ref=(block:string,tag:string)=>new RegExp(`<${tag} ObjectRef="(\\d+)"`).exec(block)?.[1];
 function component(id:string,depth:number,parentId?:string){
  if(depth>8||nodes.length>256||visited.has(id))throw Error("EFFECT_TREE_GRAPH_UNBOUNDED");visited.add(id);
  const block=object(id);if(!block.startsWith("<VideoFilterComponent "))throw Error("EFFECT_TREE_COMPONENT_KIND_UNSUPPORTED");
  const name=text(block,"InstanceName")||text(block,"DisplayName")||text(block,"MatchName"),nodeId="effect:"+id;
  nodes.push({id:nodeId,...(parentId?{parentId}:{}),depth,kind:"effect",name,key:"ECP.Filter.Expanded",objectId:id});
  const groups:Array<{id:string;depth:number}>=[{id:nodeId,depth}];
  for(const match of block.matchAll(/<Param Index="\d+" ObjectRef="(\d+)"/g)){
   const paramId=match[1]!,param=object(paramId),control=Number(text(param,"ParameterControlType")||0),name=text(param,"Name"),parent=groups.at(-1)!;
   if(control===12){if(groups.length>1)groups.pop();continue;}
   let key:string|undefined;
   if(control===11&&name)key="ECP.Group.Expanded";
   else if(param.startsWith("<PointComponentParam "))key="ECP.PointParameter.Expanded";
   else if(control===3)key="ECP.Angle.Expanded";
   else if(control===0&&param.startsWith("<VideoComponentParam ")&&!/,(?:true|false),/.test(text(param,"StartKeyframe")))key="ECP.Slider.Expanded";
   if(!key)continue;
   const id="parameter:"+paramId;nodes.push({id,parentId:parent.id,depth:parent.depth+1,kind:control===11?"group":"parameter",name,key,objectId:paramId});
   if(control===11)groups.push({id,depth:parent.depth+1});
  }
  for(const m of block.matchAll(/<SubComponent Index="\d+" ObjectRef="(\d+)"/g))component(m[1]!,depth+1,nodeId);
 }
 for(const tag of ["Components","SelectionComponents"]){const chainId=ref(clip,tag);if(!chainId)continue;for(const m of object(chainId).matchAll(/<Component Index="\d+" ObjectRef="(\d+)"/g))component(m[1]!,0);}
 return {nodes,objects};
}
export function patchEffectTreeDepth(xml:string,target:MaskArchiveTarget,expandedDepth:number){
 if(!Number.isInteger(expandedDepth)||expandedDepth< -1||expandedDepth>8)throw Error("EFFECT_TREE_INVALID_DEPTH");
 const graph=effectTreeArchive(xml,target),patches=new Map<string,string>();
 for(const node of graph.nodes){
  let block=patches.get(node.objectId)??graph.objects.get(node.objectId)!;
  const tag=`<${node.key}>${node.depth<=expandedDepth}</${node.key}>`;
  const regex=new RegExp(`<${escaped(node.key)}>([^<]*)</${escaped(node.key)}>`);
  if(regex.test(block)){if(!["true","false"].includes(regex.exec(block)![1]!))throw Error("EFFECT_TREE_UNKNOWN_PROPERTY_VALUE");block=block.replace(regex,tag);}
  else if(block.includes('<Properties Version="1">'))block=block.replace('<Properties Version="1">','<Properties Version="1">'+tag);
  else if(block.includes('<Node Version="1">'))block=block.replace('<Node Version="1">','<Node Version="1"><Properties Version="1">'+tag+'</Properties>');
  else {const nodeTag='<Node Version="1"><Properties Version="1">'+tag+'</Properties></Node>';block=block.startsWith('<VideoFilterComponent ')?block.replace('<Component Version="7">','<Component Version="7">'+nodeTag):block.replace(/^(<[^>]+>)/,'$1'+nodeTag);}
  if(!block.includes(tag))throw Error("EFFECT_TREE_OWNER_LAYOUT_UNSUPPORTED");
  if(withoutDisclosureProperties(block)!==withoutDisclosureProperties(graph.objects.get(node.objectId)!))throw Error("EFFECT_TREE_CONTENT_CHANGE_REJECTED");patches.set(node.objectId,block);
 }
 let changed=xml;for(const [id,block] of patches)changed=changed.replace(graph.objects.get(id)!,block);
 if(withoutDisclosureProperties(changed)!==withoutDisclosureProperties(xml))throw Error("EFFECT_TREE_PROJECT_CHANGE_REJECTED");
 return {xml:changed,nodes:graph.nodes,expandedDepth,contentHash:createHash('sha256').update(withoutDisclosureProperties(xml)).digest('hex')};
}
