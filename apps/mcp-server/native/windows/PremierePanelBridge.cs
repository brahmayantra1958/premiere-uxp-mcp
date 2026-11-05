using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

// Fixed panel navigation only. No mouse, keyboard, arbitrary command or UI tree traversal.
internal static class PremierePanelBridge {
 internal sealed class Request { public string panel {get;set;} public string projectName {get;set;} public string sequenceName {get;set;} }
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
 [StructLayout(LayoutKind.Sequential)] struct GuiInfo { public int size,flags; public IntPtr active,focus,capture,menuOwner,moveSize,caret; public Rect rect; }
 [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr h,int i);
 [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr h,int i);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetMenuString(IntPtr h,uint i,StringBuilder s,int n,uint f);
 [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,IntPtr l,uint f,uint timeout,out IntPtr r);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint t,ref GuiInfo i);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 static string Label(IntPtr menu,int i) { var s=new StringBuilder(600);GetMenuString(menu,(uint)i,s,s.Capacity,0x400);return s.ToString().Split('\t')[0].Replace("(&W)","").Replace("(&P)","").Replace("&","").Trim(); }
 static bool Match(string label,string en,string ko) {return label==en||label==ko;}
 static uint Find(IntPtr main,Request r) {
  var root=GetMenu(main);IntPtr window=IntPtr.Zero;
  for(int i=0;i<GetMenuItemCount(root);i++)if(Match(Label(root,i),"Window","창"))window=GetSubMenu(root,i);
  if(window==IntPtr.Zero)throw new Exception("WINDOW_MENU_NOT_FOUND");
  string en,ko;
  switch(r.panel){case "effect_controls":en="Effect Controls";ko="효과 컨트롤";break;case "properties":en="Properties";ko="속성";break;case "project":en="Projects";ko="프로젝트";break;case "program_monitor":en="Program Monitor";ko="프로그램 모니터";break;case "source_monitor":en="Source Monitor";ko="소스 모니터";break;default:throw new Exception("PANEL_NOT_ALLOWLISTED");}
  var ids=new List<uint>();
  for(int i=0;i<GetMenuItemCount(window);i++)if(Match(Label(window,i),en,ko)||r.panel=="project"&&Label(window,i)=="Project"){
   var sub=GetSubMenu(window,i);
   if(sub==IntPtr.Zero)ids.Add(GetMenuItemID(window,i));
   else {var expected=r.panel=="project"?r.projectName:r.sequenceName;for(int j=0;j<GetMenuItemCount(sub);j++)if(Label(sub,j)==expected)ids.Add(GetMenuItemID(sub,j));}
  }
  if(ids.Count!=1||ids[0]==0||ids[0]==UInt32.MaxValue)throw new Exception("PANEL_MENU_TARGET_NOT_UNIQUE");return ids[0];
 }
 public static int Main(string[] args) {
  var json=new JavaScriptSerializer();
  bool dispatched=false;
  try {
   if(args.Length!=1)throw new Exception("INVALID_REQUEST");
   var r=json.Deserialize<Request>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
   var processes=Process.GetProcessesByName("Adobe Premiere Pro");if(processes.Length!=1)throw new Exception("PREMIERE_PROCESS_AMBIGUOUS");var p=processes[0];
   if(p.ProcessName!="Adobe Premiere Pro")throw new Exception("PREMIERE_PROCESS_MISMATCH");
   var v=FileVersionInfo.GetVersionInfo(p.MainModule.FileName);
   if(v.FileMajorPart!=26||v.FileMinorPart!=5)throw new Exception("PREMIERE_VERSION_UNVERIFIED");
   var window=p.MainWindowHandle;if(window==IntPtr.Zero)throw new Exception("PREMIERE_WINDOW_MISSING");
   uint owner;var thread=GetWindowThreadProcessId(window,out owner);var info=new GuiInfo();info.size=Marshal.SizeOf(info);
   if(!GetGUIThreadInfo(thread,ref info)||info.menuOwner!=IntPtr.Zero||info.active!=window)throw new Exception("PREMIERE_MODAL_OR_MENU_OPEN");
   var command=Find(window,r);IntPtr ignored;
   dispatched=true;
   if(SendMessageTimeout(window,0x111,new IntPtr(command),IntPtr.Zero,2,800,out ignored)==IntPtr.Zero)throw new Exception("PANEL_DISPATCH_TIMEOUT_UNVERIFIED");
   info=new GuiInfo();info.size=Marshal.SizeOf(info);Rect bounds;
   if(!GetGUIThreadInfo(thread,ref info)||info.focus==IntPtr.Zero||!IsWindowVisible(info.focus)||!GetWindowRect(info.focus,out bounds))throw new Exception("PANEL_FOCUS_READBACK_UNAVAILABLE");
   uint focusOwner;GetWindowThreadProcessId(info.focus,out focusOwner);if(focusOwner!=owner)throw new Exception("PANEL_FOCUS_PROCESS_MISMATCH");
   Console.Write(json.Serialize(new {status="unverified",panel=r.panel,route="premiere_window_menu",premierePid=p.Id,version=v.FileVersion,command,dispatchAccepted=true,
    focus=new {handle=info.focus.ToInt64(),visible=true,left=bounds.left,top=bounds.top,width=bounds.right-bounds.left,height=bounds.bottom-bounds.top},
    reason="Native menu dispatch and visible Premiere focus verified; semantic panel identity/expanded effect/scroll position are not exposed by this bridge."}));return 0;
  }catch(Exception e){Console.Write(json.Serialize(new {status=dispatched?"unverified":"unsupported",reason=e.Message}));return 1;}
 }
}
