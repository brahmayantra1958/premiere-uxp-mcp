using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Accessibility;

// Explicit approval is required before compiling the dispatch branch. The
// ordinary build is a read-only planner; it cannot synthesize input.
class PremiereEffectDisclosureNotification {
 internal class Request { public int pid {get;set;} public long handle {get;set;} public string tab {get;set;} public int childId {get;set;} public bool expanded {get;set;} }
 [DllImport("oleacc.dll")]static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
#if APPROVED_EFFECT_DISCLOSURE_NOTIFICATIONS
 [StructLayout(LayoutKind.Sequential)]struct Point {public int x,y;}
 [DllImport("user32.dll")]static extern bool ScreenToClient(IntPtr h,ref Point p);
 [DllImport("user32.dll")]static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
#endif
 static string Name(IAccessible a){return a.get_accName(0);}
 static int State(IAccessible a){return Convert.ToInt32(a.get_accState(0));}
 public static int Main(string[] args){Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();bool dispatched=false;try{
  if(args.Length!=1)throw new Exception("INVALID_REQUEST");var r=json.Deserialize<Request>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
  if(r.pid<=0||r.handle<=0||String.IsNullOrEmpty(r.tab)||r.tab.Length>1800||r.childId<1||r.childId>2048)throw new Exception("INVALID_TARGET");
  var process=Process.GetProcessById(r.pid);var version=FileVersionInfo.GetVersionInfo(process.MainModule.FileName);if(process.ProcessName!="Adobe Premiere Pro"||version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("VERSION_UNVERIFIED");
  var h=new IntPtr(r.handle);uint owner;GetWindowThreadProcessId(h,out owner);if(owner!=r.pid)throw new Exception("PROCESS_CHANGED");
  var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object raw;if(AccessibleObjectFromWindow(h,0xFFFFFFFC,ref iid,out raw)!=0)throw new Exception("PANEL_MISSING");var root=(IAccessible)raw;if(Name(root)!="Effect Controls"||root.accChildCount>2048||r.childId>root.accChildCount)throw new Exception("PANEL_CHANGED");
  IAccessible selected=null,viewport=null;for(int i=1;i<=Math.Min(16,root.accChildCount);i++){var n=root.get_accChild(i) as IAccessible;if(n==null)continue;if(Name(n)==r.tab&&(State(n)&8)!=0){if(selected!=null)throw new Exception("TAB_AMBIGUOUS");selected=n;}if(Name(n)=="UI_ScrollBar")viewport=n;}
  if(selected==null||viewport==null)throw new Exception("TARGET_NOT_SELECTED");var control=root.get_accChild(r.childId) as IAccessible;if(control==null||Name(control)!="UI_DisclosureTriangleButton"||Convert.ToInt32(control.get_accRole(0))!=43)throw new Exception("NOT_A_DISCLOSURE_CONTROL");
  int state=State(control),x,y,w,height,vx,vy,vw,vh;control.accLocation(out x,out y,out w,out height,0);viewport.accLocation(out vx,out vy,out vw,out vh,0);
  if((state&(1|32768|65536))!=0||w<10||w>40||height!=w||y<vy||y+height>vy+vh||x+w>=vx)throw new Exception("DISCLOSURE_NOT_VISIBLE");
  // Layout is never cached across operations. Reject movement during planning;
  // a later request must rediscover the window and control after a resize/dock.
  Thread.Sleep(80);int x2,y2,w2,h2,vx2,vy2,vw2,vh2;
  control.accLocation(out x2,out y2,out w2,out h2,0);viewport.accLocation(out vx2,out vy2,out vw2,out vh2,0);
  if(x!=x2||y!=y2||w!=w2||height!=h2||vx!=vx2||vy!=vy2||vw!=vw2||vh!=vh2||State(control)!=state||Name(selected)!=r.tab||(State(selected)&8)==0)throw new Exception("LAYOUT_CHANGED_REINSPECT");
  if(((state&8)!=0)==r.expanded){Console.Write(json.Serialize(new{status="pass",changed=false,state}));return 0;}
#if APPROVED_EFFECT_DISCLOSURE_NOTIFICATIONS
  var point=new Point{x=x+w/2,y=y+height/2};if(!ScreenToClient(h,ref point)||point.x<0||point.y<0||point.x>32767||point.y>32767)throw new Exception("CLIENT_POINT_INVALID");
  IntPtr result;var location=new IntPtr((point.y<<16)|(point.x&65535));bool down=false,up=false;dispatched=true;
  try{down=SendMessageTimeout(h,0x0201,new IntPtr(1),location,2,600,out result)!=IntPtr.Zero;}
  finally{up=SendMessageTimeout(h,0x0202,IntPtr.Zero,location,2,600,out result)!=IntPtr.Zero;}
  Thread.Sleep(80);GetWindowThreadProcessId(h,out owner);if(!down||!up||owner!=r.pid||Name(selected)!=r.tab||(State(selected)&8)==0)throw new Exception("DISPATCH_UNVERIFIED_NO_REPLAY");
  // Read the exact native object's current state. A notification return code
  // alone never proves disclosure; no second toggle is attempted on mismatch.
  int after=State(control);if(Name(control)!="UI_DisclosureTriangleButton"||((after&8)!=0)!=r.expanded)throw new Exception("DISCLOSURE_READBACK_MISMATCH");
  Console.Write(json.Serialize(new{status="pass",changed=true,before=state,after,route="approved_directed_disclosure_notification",premierePid=r.pid,panelHandle=r.handle,selectedClipTab=r.tab}));return 0;
#else
  Console.Write(json.Serialize(new{status="unsupported",reason="EXPLICIT_DISCLOSURE_INPUT_APPROVAL_REQUIRED",dispatchEnabled=false,childId=r.childId,desiredExpanded=r.expanded,before=state,bounds=new{x,y,w,height},selectedClipTab=r.tab}));return 0;
#endif
 }catch(Exception e){Console.Write(json.Serialize(new{status=dispatched?"unverified":"fail",dispatchAttempted=dispatched,reason=e.Message}));return 1;}}
}
