import {describe,it,expect} from "vitest";
import {nativeToolStateProves} from "../../packages/contracts/src/panel-work.js";
const observed={protocol:1,status:"pass",route:"windows_msaa_tool_state",premierePid:123,panel:"Tools",selectedTools:[{name:"선택 도구",role:43,state:8}]};
describe("independent native tool proof",()=>{
 it("requires matching identity and one selected tool",()=>{
  expect(nativeToolStateProves("selection_tool",observed,123)).toBe(true);
  expect(nativeToolStateProves("razor_tool",observed,123)).toBe(false);
  expect(nativeToolStateProves("selection_tool",observed,456)).toBe(false);
 });
 it.each([0,1,32776,65544])("rejects unselected, unavailable, hidden or offscreen state %d",state=>{
  expect(nativeToolStateProves("selection_tool",{...observed,selectedTools:[{name:"선택 도구",role:43,state}]},123)).toBe(false);
 });
 it("rejects ambiguity, wrong roles and a non-native observation",()=>{
  expect(nativeToolStateProves("selection_tool",{...observed,selectedTools:[...observed.selectedTools,...observed.selectedTools]},123)).toBe(false);
  expect(nativeToolStateProves("selection_tool",{...observed,selectedTools:[{name:"선택 도구",role:10,state:8}]},123)).toBe(false);
  expect(nativeToolStateProves("selection_tool",{...observed,route:"mock"},123)).toBe(false);
 });
});
