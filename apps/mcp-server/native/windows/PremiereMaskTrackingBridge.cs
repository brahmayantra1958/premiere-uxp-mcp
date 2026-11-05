using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Accessibility;

// One frame of native mask tracking via semantic accessibility. No mouse/keys.
internal static class PremiereMaskTrackingBridge {
 internal sealed class Request { public int pid {get;set;} public long handle {get;set;} public string sequenceName {get;set;} public string clipName {get;set;} public string direction {get;set;} }
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible a,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]object[] children,out int obtained);
 static string Name(IAccessible a){try{return a.get_accName(0);}catch{return null;}}
 public static int Main(string[] args){Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();bool dispatched=false;try{
  if(args.Length!=1)throw new Exception("INVALID_REQUEST");var r=json.Deserialize<Request>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
  if(r.pid<=0||r.handle<=0||String.IsNullOrEmpty(r.sequenceName)||String.IsNullOrEmpty(r.clipName)||r.sequenceName.Length+r.clipName.Length>1800||(r.direction!="forward"&&r.direction!="backward"))throw new Exception("INVALID_MASK_TRACK_TARGET");
  var process=Process.GetProcessById(r.pid);if(process.ProcessName!="Adobe Premiere Pro")throw new Exception("WRONG_PROCESS");
  var version=FileVersionInfo.GetVersionInfo(process.MainModule.FileName);if(version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("PREMIERE_VERSION_UNVERIFIED");
  var window=new IntPtr(r.handle);uint owner;GetWindowThreadProcessId(window,out owner);if(owner!=r.pid||!IsWindowVisible(window))throw new Exception("WRONG_NATIVE_PANEL");
  var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object value;if(AccessibleObjectFromWindow(window,0xFFFFFFFC,ref iid,out value)!=0||!(value is IAccessible))throw new Exception("MASK_PANEL_UNAVAILABLE");
  var root=(IAccessible)value;if(Name(root)!="Effect Controls")throw new Exception("WRONG_PANEL");
  int count=root.accChildCount;if(count<1||count>2048)throw new Exception("MASK_UI_UNBOUNDED");
  var children=new object[count];int got;if(AccessibleChildren(root,0,count,children,out got)!=0||got!=count)throw new Exception("MASK_UI_INCOMPLETE");
  string ko=r.direction=="forward"?"선택한 마스크 1프레임 앞으로 추적":"선택한 마스크 1프레임 뒤로 추적";
  string en=r.direction=="forward"?"Track selected mask forward 1 frame":"Track selected mask backward 1 frame";
  int selected=0;IAccessible button=null;var timer=Stopwatch.StartNew();
  foreach(var child in children){
   if(timer.ElapsedMilliseconds>1800)throw new Exception("MASK_UI_TIMEOUT_BEFORE_DISPATCH");
   var node=child as IAccessible;if(node==null)throw new Exception("MASK_UI_NODE_UNSUPPORTED");var name=Name(node);
   if(name==r.sequenceName+" • "+r.clipName){int state=Convert.ToInt32(node.get_accState(0));if((state&8)!=0&&(state&(1|32768|65536))==0)selected++;}
   if(name==ko||name==en){int state=Convert.ToInt32(node.get_accState(0)),role=Convert.ToInt32(node.get_accRole(0));
    // Premiere also exposes unused template widgets. Only the enabled,
    // focusable native mask control is an actionable button.
    if(role==43&&(state&1048576)!=0&&(state&(1|32768|65536))==0){if(button!=null)throw new Exception("MASK_TRACK_CONTROL_NOT_UNIQUE");button=node;}
   }
  }
  if(selected!=1||button==null)throw new Exception("NATIVE_MASK_TARGET_UNVERIFIED");
  dispatched=true;button.accDoDefaultAction(0);
  Console.Write(json.Serialize(new {protocol=1,status="unverified",route="windows_msaa_mask_tracking",premierePid=r.pid,selectedClipTab=r.sequenceName+" • "+r.clipName,direction=r.direction,frames=1,dispatchAccepted=true,elapsedMs=timer.ElapsedMilliseconds}));return 0;
 }catch(Exception e){Console.Write(json.Serialize(new {status=dispatched?"unverified":"fail",route="windows_msaa_mask_tracking",dispatchAccepted=dispatched,reason=e.Message}));return 1;}}
}
