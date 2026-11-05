using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Accessibility;

// Read-only observation of the native Tools pane. No input synthesis or actions.
internal static class PremiereToolStateBridge {
 private delegate bool ChildCallback(IntPtr window,IntPtr state);
 [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent,ChildCallback callback,IntPtr state);
 [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr window,uint objectId,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 [DllImport("oleacc.dll")] private static extern int AccessibleChildren(IAccessible parent,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]object[] children,out int obtained);
 private static object Observe(Func<object> read){try{return read();}catch{return null;}}

 public static int Main(string[] args){Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();try {
  int pid;if(args.Length!=1||!Int32.TryParse(args[0],out pid)||pid<=0)throw new Exception("EXACT_PREMIERE_PID_REQUIRED");
  var process=Process.GetProcessById(pid);if(process.ProcessName!="Adobe Premiere Pro")throw new Exception("PREMIERE_PROCESS_MISMATCH");
  var version=FileVersionInfo.GetVersionInfo(process.MainModule.FileName);if(version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("PREMIERE_VERSION_UNVERIFIED");
  var timer=Stopwatch.StartNew();var selected=new List<object>();int visited=0,panelCount=0;bool truncated=false;long panelHandle=0;
  EnumChildWindows(process.MainWindowHandle,(window,unused)=>{
   if(++visited>160||timer.ElapsedMilliseconds>900){truncated=true;return false;}
   uint owner;GetWindowThreadProcessId(window,out owner);if(owner!=pid||!IsWindowVisible(window))return true;
   var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object obj;
   if(AccessibleObjectFromWindow(window,0xFFFFFFFC,ref iid,out obj)!=0||!(obj is IAccessible))return true;var root=(IAccessible)obj;
   var name=Observe(()=>root.get_accName(0)) as string;if(name!="Tools"&&name!="도구")return true;
   panelCount++;panelHandle=window.ToInt64();int count=root.accChildCount;if(count<1||count>100)throw new Exception("TOOL_CHILD_COUNT_UNBOUNDED");
   var children=new object[count];int got;if(AccessibleChildren(root,0,count,children,out got)<0||got!=count)throw new Exception("TOOL_CHILDREN_INCOMPLETE");
   for(int i=0;i<got;i++){
    var child=children[i] as IAccessible;if(child==null)throw new Exception("TOOL_NODE_UNSUPPORTED");
    var state=Observe(()=>child.get_accState(0));var role=Observe(()=>child.get_accRole(0));if(!(state is int)||!(role is int))throw new Exception("TOOL_STATE_UNAVAILABLE");
    if(((int)state&8)!=0)selected.Add(new {name=Observe(()=>child.get_accName(0)),role=(int)role,state=(int)state,value=Observe(()=>child.get_accValue(0))});
   }
   return true;
  },IntPtr.Zero);
  if(truncated||panelCount!=1)throw new Exception("NATIVE_TOOLS_PANE_NOT_UNIQUE_OR_INCOMPLETE: panels="+panelCount+", visited="+visited+", truncated="+truncated+", elapsedMs="+timer.ElapsedMilliseconds);
  Console.Write(json.Serialize(new {protocol=1,status="pass",route="windows_msaa_tool_state",premierePid=pid,panel="Tools",panelHandle,selectedTools=selected,elapsedMs=timer.ElapsedMilliseconds}));return 0;
 }catch(Exception e){Console.Write(json.Serialize(new {status="unsupported",route="windows_msaa_tool_state",reason=e.Message}));return 1;}}
}
