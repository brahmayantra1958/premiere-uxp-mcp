using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Accessibility;
// Effect boundary: bounded fresh MSAA observation only, no native actions.
internal static class PremiereEffectStateBridge {
 internal static bool WorkerMode=false;
 // Keep MSAA calls on the worker's owning thread. Premiere services them on
 // its UI thread; concurrent COM callers add marshalling/contended work without
 // establishing faster reads, especially while a project reconstructs.
 // Ask the panel root by 1-based child ID (the order AccessibleChildren and
 // get_accChild use) instead of through one COM proxy per child. On Premiere
 // 26.5 (measured 2026-11-06, 305 nodes) both routes returned identical names,
 // roles, states, values and locations, but the proxy route paid about 8 ms per
 // child to enumerate plus 20-40 ms for the first call on each new proxy, while
 // a child-ID read costs about 2 ms. Applying or disclosing an effect rebuilds
 // every child, so the proxy route exceeded the budget on ~2,000-node panels.
 internal static string[] ReadNames(IAccessible root,int start,int length,Stopwatch timer,long budget){
  var names=new string[length];bool any=false;
  for(int i=0;i<length;i++){
   if(timer.ElapsedMilliseconds>budget)throw new Exception("ACCESSIBILITY_NAME_READ_BUDGET");
   object child=start+i+1;names[i]=Read(()=>root.get_accName(child)) as string;any|=names[i]!=null;
  }
  if(length>=4&&!any)throw new Exception("ACCESSIBILITY_CHILD_ID_UNSUPPORTED");
  if(timer.ElapsedMilliseconds>budget)throw new Exception("ACCESSIBILITY_NAME_READ_BUDGET");return names;
 }
 private delegate bool Callback(IntPtr window,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,Callback callback,IntPtr state);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [StructLayout(LayoutKind.Sequential)] struct GuiInfo {public uint size,flags;public IntPtr active,focus,capture,menuOwner,moveSize,caret;public int left,top,right,bottom;}
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr window,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 static object Read(Func<object> getter){try{return getter();}catch{return null;}}
 static Dictionary<string,object> Node(IAccessible root,object child){
  var r=new Dictionary<string,object>{{"name",Read(()=>root.get_accName(child))},{"value",Read(()=>root.get_accValue(child))},{"role",Read(()=>root.get_accRole(child))},{"state",Read(()=>root.get_accState(child))}};
  try{int x,y,w,h;root.accLocation(out x,out y,out w,out h,child);r["left"]=x;r["top"]=y;r["width"]=w;r["height"]=h;}catch{}return r;
 }
 internal sealed class Hints {public long handle {get;set;}public int count {get;set;}public int tab {get;set;}public int viewport {get;set;}public int[] headers {get;set;}public int[] parameters {get;set;}}
 static IAccessible Root(IntPtr h,int pid,bool focused){
  uint owner;uint thread=GetWindowThreadProcessId(h,out owner);var gui=new GuiInfo();gui.size=(uint)Marshal.SizeOf(gui);
  if(owner!=pid||!IsWindowVisible(h)||focused&&(!GetGUIThreadInfo(thread,ref gui)||gui.focus!=h))throw new Exception("WINDOW_CHANGED");
  var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object raw;if(AccessibleObjectFromWindow(h,0xFFFFFFFC,ref iid,out raw)!=0||!(raw is IAccessible))throw new Exception("PANEL_MISSING");
  var root=(IAccessible)raw;if(root.get_accName(0)!="Effect Controls")throw new Exception("WRONG_PANEL");return root;
 }
 static object Id(int index,int count){if(index<0||index>=count)throw new Exception("HINT_INDEX_INVALID");return index+1;}
 static bool Enable(string name){return name=="효과 켜기/끄기"||name=="Toggle the effect on or off";}
 static object FastRead(int pid,string target,Hints hints){
  if(hints==null||hints.count<1||hints.count>16384||hints.headers==null||hints.headers.Length<1||hints.headers.Length>128)throw new Exception("HINT_LAYOUT_INVALID");
  var root=Root(new IntPtr(hints.handle),pid,false);if(root.accChildCount!=hints.count)throw new Exception("HINT_TREE_CHANGED");
  var tab=Id(hints.tab,hints.count);int tabState=Convert.ToInt32(root.get_accState(tab));
  if(root.get_accName(tab)!=target||Convert.ToInt32(root.get_accRole(tab))!=43||(tabState&8)==0||(tabState&(1|32768|65536))!=0)throw new Exception("HINT_TAB_CHANGED");
  var headers=new List<object>();foreach(var i in hints.headers){var header=Id(i,hints.count);var enable=Id(i+1,hints.count);if(Convert.ToInt32(root.get_accRole(header))!=43||!Enable(root.get_accName(enable)))throw new Exception("HINT_HEADER_CHANGED");var node=Node(root,header);if((Convert.ToInt32(node["state"])&32768)!=0)node["enable"]=Node(root,enable);headers.Add(node);}
  var viewport=Id(hints.viewport,hints.count);if(root.get_accName(viewport)!="UI_ScrollBar"||Convert.ToInt32(root.get_accRole(viewport))!=3)throw new Exception("HINT_VIEWPORT_CHANGED");
  return new {protocol=1,status="pass",route="windows_msaa_effect_state",premierePid=pid,panelHandle=hints.handle,selectedClipTab=target,headers,viewport=Node(root,viewport),hints,indexedObservation=true};
 }
 static object Observe(int pid,string target,IntPtr handle,IAccessible root){
  var timer=Stopwatch.StartNew();int count=root.accChildCount;if(count<1||count>16384)throw new Exception("EFFECT_CHILD_COUNT_UNBOUNDED");
  var names=ReadNames(root,0,count,timer,12000);
  var headers=new List<object>();var indices=new List<int>();var parameters=new List<int>();var hints=new Hints {handle=handle.ToInt64(),count=count,tab=-1,viewport=-1};
  object viewport=null;int selected=0;
  for(int i=0;i<count;i++){
   if(timer.ElapsedMilliseconds>12000)throw new Exception("EFFECT_OBSERVATION_TIMEOUT");
   object child=i+1;var name=names[i];
   if(name=="UI_DisclosureTriangleButton")parameters.Add(i);
   if(name==target){var state=Read(()=>root.get_accState(child));var role=Read(()=>root.get_accRole(child));if(role is int&&(int)role==43&&state is int&&((int)state&8)!=0){selected++;hints.tab=i;}}
   if(name=="UI_ScrollBar"){viewport=Node(root,child);hints.viewport=i;}
   if(Enable(name)&&i>0){object previous=i;var header=Node(root,previous);if(Convert.ToInt32(header["role"])!=43)throw new Exception("EFFECT_HEADER_ROLE_CHANGED");if((Convert.ToInt32(header["state"])&32768)!=0)header["enable"]=Node(root,child);headers.Add(header);indices.Add(i-1);}
  }
  if(root.accChildCount!=count)throw new Exception("EFFECT_TREE_CHANGED_DURING_OBSERVATION");
  if(selected>1)throw new Exception("AMBIGUOUS_SELECTED_TAB");hints.headers=indices.ToArray();hints.parameters=parameters.ToArray();
  return new {protocol=1,status="pass",route="windows_msaa_effect_state",premierePid=pid,panelHandle=handle.ToInt64(),selectedClipTab=selected==1?target:null,headers,viewport,hints,indexedObservation=false,elapsedMs=timer.ElapsedMilliseconds};
 }
 public static int Main(string[] args){if(!WorkerMode)Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();try{
  int pid;if((args.Length!=2&&args.Length!=3)||!Int32.TryParse(args[0],out pid)||pid<=0)throw new Exception("EXACT_PREMIERE_PID_REQUIRED");
  var target=Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));if(target.Length<1||target.Length>1800)throw new Exception("EXACT_CLIP_TAB_REQUIRED");
  var process=Process.GetProcessById(pid);if(process.ProcessName!="Adobe Premiere Pro")throw new Exception("WRONG_PROCESS");
  var version=FileVersionInfo.GetVersionInfo(process.MainModule.FileName);if(version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("PREMIERE_VERSION_UNVERIFIED");
  if(args.Length==3){
   var hints=json.Deserialize<Hints>(Encoding.UTF8.GetString(Convert.FromBase64String(args[2])));
   try{Console.Write(json.Serialize(FastRead(pid,target,hints)));return 0;}catch{}
   // Reacquire changed children in the exact still-visible pane. This also proves
   // selection clearing without a costly whole-application scan or cached state.
   var h=new IntPtr(hints.handle);IAccessible rebound=null;try{rebound=Root(h,pid,false);}catch{}
   if(rebound!=null){Console.Write(json.Serialize(Observe(pid,target,h,rebound)));return 0;}
  }
  // The mandatory panel-focus command already identifies one native focus HWND.
  // Validate that exact owner/name before falling back to a whole-window scan.
  // This avoids probing every unrelated Premiere child after UI reconstruction.
  uint mainOwner;uint mainThread=GetWindowThreadProcessId(process.MainWindowHandle,out mainOwner);
  var focus=new GuiInfo();focus.size=(uint)Marshal.SizeOf(focus);IAccessible focused=null;
  if(mainOwner==pid&&GetGUIThreadInfo(mainThread,ref focus)&&focus.focus!=IntPtr.Zero){try{focused=Root(focus.focus,pid,true);}catch{}}
  if(focused!=null){Console.Write(json.Serialize(Observe(pid,target,focus.focus,focused)));return 0;}
  var timer=Stopwatch.StartNew();int windows=0,panels=0;bool incomplete=false;IntPtr found=IntPtr.Zero;IAccessible foundRoot=null;
  EnumChildWindows(process.MainWindowHandle,(window,unused)=>{
   if(++windows>180||timer.ElapsedMilliseconds>8000){incomplete=true;return false;}
   try{var root=Root(window,pid,false);panels++;found=window;foundRoot=root;}catch{}return true;
  },IntPtr.Zero);
  if(incomplete||panels!=1)throw new Exception("EFFECT_OBSERVATION_INCOMPLETE_OR_AMBIGUOUS");
  Console.Write(json.Serialize(Observe(pid,target,found,foundRoot)));return 0;
 }catch(Exception e){Console.Write(json.Serialize(new {status="unverified",route="windows_msaa_effect_state",reason=e.Message}));return 1;}}
}
