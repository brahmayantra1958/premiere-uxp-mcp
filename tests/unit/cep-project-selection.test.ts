import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import type { Server } from "node:http";

const service = createRequire(import.meta.url)("../../apps/cep-project-selection/service.cjs");
const scope = { projectPath: "C:\\work\\edit.prproj", sequenceId: "seq-123", sequenceName: "WORKING__test" };
function request(overrides = {}) { return { version: 1, id: "test-123456", operation: "set_project_selection", expiresAt: Date.now()+15000, ...scope,
  target: {pathSegments:["Footage","source.mov"],kind:"clip",mediaPath:"C:\\media\\source.mov"}, ...overrides }; }
function fixture() {
  const source = {name:"source.mov",nodeId:"native-source",type:1,isSequence:()=>false,getMediaPath:()=>"C:\\media\\source.mov"};
  const folder = {name:"Footage",nodeId:"native-folder",type:2,children:{0:source,numItems:1}};
  const sequence = {name:"Sequence",nodeId:"native-sequence",type:1,isSequence:()=>true};
  const project:any = {path:scope.projectPath,activeSequence:{name:scope.sequenceName,sequenceID:scope.sequenceId},rootItem:{children:{0:folder,1:sequence,numItems:2}},sequences:{0:{sequenceID:scope.sequenceId,projectItem:sequence},numSequences:1}};
  let selection:any[]=[folder];
  const app = {project,getProjectViewIDs:()=>["view-1"],getProjectFromViewID:()=>project,getProjectViewSelection:()=>selection,
    setProjectViewSelection:vi.fn((items:any[],view:string)=>{expect(view).toBe("view-1");selection=items;})};
  const code=readFileSync("apps/cep-project-selection/host/selection.jsx","utf8").replace("__BRAHMA_YANTRA_PROJECT_SELECTION_SCOPE__",JSON.stringify(scope));
  const context:any={app,JSON:undefined};runInNewContext(code,context);
  return {app,source,folder,project,selection:()=>selection,execute:(value:any)=>JSON.parse(runInNewContext(service.expression(value),context))};
}
describe("project-selection-only CEP adapter (fixture, not live proof)",()=>{
  it("resolves nested source identity and verifies native selection without JSON global",()=>{
    const f=fixture(),r=f.execute(request());expect(r).toMatchObject({status:"pass",beforeIds:["native-folder"],afterIds:["native-source"]});
    expect(f.selection()[0]).toBe(f.source);
  });
  it("validates sequence identity separately from media paths",()=>{
    const f=fixture();expect(f.execute(request({target:{pathSegments:["Sequence"],kind:"sequence",sequenceId:scope.sequenceId}})).status).toBe("pass");
    expect(f.execute(request({target:{pathSegments:["Sequence"],kind:"sequence",sequenceId:"wrong"}})).status).toBe("fail");
    expect(f.app.setProjectViewSelection).toHaveBeenCalledOnce();
  });
  it("reads selected items without executing a setter",()=>{
    const f=fixture();expect(f.execute(request({operation:"read_project_selection",target:undefined}))).toMatchObject({status:"pass",ids:["native-folder"]});expect(f.app.setProjectViewSelection).not.toHaveBeenCalled();
  });
  it.each(["project","sequence","media","duplicate","view"])("rejects stale or ambiguous %s before mutation",field=>{
    const f=fixture();
    if(field==="project")f.project.path="C:\\other.prproj";
    if(field==="sequence")f.project.activeSequence.sequenceID="other";
    if(field==="media")f.source.getMediaPath=()=>"C:\\other.mov";
    if(field==="duplicate"){(f.folder.children as any)[1]={...f.source,nodeId:"duplicate"};f.folder.children.numItems=2;}
    if(field==="view")f.app.getProjectViewIDs=()=>["view-1","view-2"];
    expect(f.execute(request()).status).toBe("fail");expect(f.app.setProjectViewSelection).not.toHaveBeenCalled();
  });
  it("rejects silent setter failure and proves restoration",()=>{
    const f=fixture();f.app.setProjectViewSelection.mockImplementationOnce(()=>{});
    expect(f.execute(request())).toMatchObject({status:"fail",restored:true});expect(f.selection()).toEqual([f.folder]);
  });
  it("does not restore into a different project after dispatch",()=>{
    const f=fixture();f.app.setProjectViewSelection.mockImplementationOnce(()=>{f.project.path="C:\\other.prproj";});
    expect(f.execute(request())).toMatchObject({status:"unverified",restored:false});expect(f.app.setProjectViewSelection).toHaveBeenCalledOnce();
  });
  it("keeps malicious names as literal data and rejects executable fields",()=>{
    const f=fixture(),name='" ); app.project.save(); //\u2028';f.source.name=name;
    expect(f.execute(request({target:{...request().target,pathSegments:["Footage",name]}})).status).toBe("pass");
    for(const extra of [{script:"app.project.save()"},{operation:"eval"},{target:{...request().target,code:"anything"}},{target:{pathSegments:["x"],kind:"clip"}}])expect(()=>service.validate(request(extra))).toThrow();
  });
});
describe("project-selection authenticated service",()=>{
  it("rejects unauthenticated input, limits operations and de-duplicates dispatch",async()=>{
    const evaluate=vi.fn((_script:string,callback:(text:string)=>void)=>callback('{"status":"pass"}'));
    const config={port:0,token:"a".repeat(64)};const server:Server=service.createProjectSelectionServer(config,evaluate,()=>{});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));config.port=(server.address() as any).port;
    const url=`http://127.0.0.1:${config.port}/selection`,headers={authorization:`Bearer ${config.token}`,"content-type":"application/json"},body=JSON.stringify(request());
    try{
      expect((await fetch(url,{method:"POST",body})).status).toBe(401);
      expect((await fetch(url,{method:"POST",headers,body:JSON.stringify(request({operation:"eval"}))})).status).toBe(400);
      for(let i=0;i<2;i++)expect((await fetch(url,{method:"POST",headers,body})).status).toBe(200);
      expect((await fetch(url,{method:"POST",headers,body:JSON.stringify(request({target:{...request().target,mediaPath:"other"}}))})).status).toBe(409);
      expect(evaluate).toHaveBeenCalledOnce();
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
