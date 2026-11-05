import {describe,it,expect,vi} from "vitest";
import {uxpModules} from "../helpers/uxp-modules.js";
function fixture(){
  const source={name:"source.mov",getId:()=>"source-id",isSequence:()=>false,getMediaFilePath:()=>"C:\\media\\source.mov"};
  const folder={name:"Footage",getId:()=>"folder-id",getItems:()=>[source]};
  const sequence={name:"WORKING__test",guid:"sequence-id"};
  const project={guid:"project-id",name:"Project",path:"C:\\scratch\\test.prproj",getActiveSequence:()=>sequence,getRootItem:()=>({getId:()=>"root",getItems:()=>[folder]})};
  const selected:any[]=[];
  const ppro={Project:{getActiveProject:()=>project},FolderItem:{cast:(raw:any)=>raw.getItems?raw:null},ClipProjectItem:{cast:(raw:any)=>raw},ProjectUtils:{getSelection:()=>({getItems:()=>selected})}};
  const reveal=uxpModules(ppro)("apps/uxp-plugin/src/host-project-work.ts").revealProjectItem;
  const request={version:1,id:"request-id",command:"query_media",args:{expectedProjectId:project.guid,expectedSequenceId:sequence.guid},timeoutMs:20000};
  return {source,selected,sequence,project,request,reveal};
}
describe("native project visibility proof",()=>{
  it("uses full breadcrumbs then independently verifies the exact canonical selection",async()=>{
    const f=fixture(),select=vi.fn(async()=>{f.selected.push(f.source);return {status:"pass"};});
    expect(await f.reveal(f.request,"source-id",select)).toMatchObject({status:"pass",selectedProjectItemIds:["source-id"]});
    expect(select).toHaveBeenCalledWith("request-id",{pathSegments:["Footage","source.mov"],kind:"clip",mediaPath:"C:\\media\\source.mov"});
  });
  it("does not mistake CEP acknowledgement for UXP selection proof",async()=>{
    const f=fixture();expect(await f.reveal(f.request,"source-id",async()=>({status:"pass"}))).toMatchObject({status:"unverified",selectedProjectItemIds:[]});
  });
  it("preserves unsupported install status without claiming selection",async()=>{
    const f=fixture();expect(await f.reveal(f.request,"source-id",async()=>({status:"unsupported",reason:"not installed"}))).toMatchObject({status:"unsupported",reason:"not installed"});
  });
  it("rejects stale input and context drift during selection",async()=>{
    const f=fixture(),select=vi.fn(async()=>({status:"pass"}));
    await expect(f.reveal({...f.request,args:{expectedProjectId:"wrong"}},"source-id",select)).rejects.toThrow("target changed");expect(select).not.toHaveBeenCalled();
    await expect(f.reveal(f.request,"source-id",async()=>{f.sequence.guid="other";return {status:"pass"};})).rejects.toThrow("identity changed");
  });
});
