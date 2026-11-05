using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Accessibility;

// Exact native pane scrolling. No pointer movement, clicks, keys or global input.
// The server independently reads back the resulting header and viewport bounds.
internal static class PremiereEffectScrollBridge {
 internal static bool WorkerMode=false;
 internal sealed class Hints {public long handle {get;set;}public int count {get;set;}public int tab {get;set;}public int viewport {get;set;}public int[] headers {get;set;}}
 internal sealed class Request {public int pid {get;set;}public long handle {get;set;}public string tab {get;set;}public int headerIndex {get;set;}public int headerCount {get;set;}public int initialRowsHeight {get;set;}public Hints hints {get;set;}}
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible a,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]object[] children,out int obtained);
 static string Name(IAccessible a){try{return a.get_accName(0);}catch{return null;}}
 static int State(IAccessible a){return Convert.ToInt32(a.get_accState(0));}
 static IAccessible Child(IAccessible root,int index,int count){if(index<0||index>=count)throw new Exception("HINT_INDEX_INVALID");var child=root.get_accChild(index+1) as IAccessible;if(child==null)throw new Exception("HINT_CHILD_MISSING");return child;}
 static bool Indexed(IAccessible root,Request r,int count,out List<IAccessible> headers,out List<IAccessible> anchors,out IAccessible viewport,out IAccessible tab){
  headers=new List<IAccessible>();anchors=new List<IAccessible>();viewport=null;tab=null;
  try{
   var hint=r.hints;if(hint==null||hint.handle!=r.handle||hint.count!=count||hint.headers==null||hint.headers.Length!=r.headerCount)return false;
   tab=Child(root,hint.tab,count);if(Name(tab)!=r.tab||Convert.ToInt32(tab.get_accRole(0))!=43||(State(tab)&8)==0)return false;
   viewport=Child(root,hint.viewport,count);if(Name(viewport)!="UI_ScrollBar"||Convert.ToInt32(viewport.get_accRole(0))!=3)return false;
   foreach(int i in hint.headers){var header=Child(root,i,count);var anchor=Child(root,i+1,count);var enable=Name(anchor);if(Convert.ToInt32(header.get_accRole(0))!=43||(enable!="효과 켜기/끄기"&&enable!="Toggle the effect on or off"))return false;headers.Add(header);anchors.Add(anchor);}
   return true;
  }catch{return false;}
 }
 static void Scroll(IntPtr h,int px,int py,int delta){IntPtr result;if(SendMessageTimeout(h,0x020A,new IntPtr(delta<<16),new IntPtr((py<<16)|(px&65535)),2,600,out result)==IntPtr.Zero)throw new Exception("SCROLL_NOTIFICATION_UNVERIFIED");Thread.Sleep(50);}
 public static int Main(string[] args){if(!WorkerMode)Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();bool dispatched=false;try{
  if(args.Length!=1)throw new Exception("INVALID_REQUEST");var r=json.Deserialize<Request>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
  if(r.pid<=0||r.handle<=0||String.IsNullOrEmpty(r.tab)||r.tab.Length>1800||r.headerCount<1||r.headerCount>128||r.headerIndex<0||r.headerIndex>=r.headerCount||(r.initialRowsHeight!=21&&r.initialRowsHeight!=42&&r.initialRowsHeight!=80))throw new Exception("INVALID_EFFECT_TARGET");
  var process=Process.GetProcessById(r.pid);var version=FileVersionInfo.GetVersionInfo(process.MainModule.FileName);if(process.ProcessName!="Adobe Premiere Pro"||version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("UNVERIFIED_PREMIERE_VERSION");
  uint owner;var h=new IntPtr(r.handle);GetWindowThreadProcessId(h,out owner);if(owner!=r.pid)throw new Exception("WRONG_PROCESS");
  var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object raw;if(AccessibleObjectFromWindow(h,0xFFFFFFFC,ref iid,out raw)!=0||!(raw is IAccessible))throw new Exception("NO_PANEL");
  var root=(IAccessible)raw;if(Name(root)!="Effect Controls")throw new Exception("WRONG_PANEL");int count=root.accChildCount;if(count<1||count>16384)throw new Exception("UNBOUNDED_PANEL");
  List<IAccessible> headers,anchors;IAccessible viewport,tab;var timer=Stopwatch.StartNew();bool indexed=Indexed(root,r,count,out headers,out anchors,out viewport,out tab);
  if(!indexed){
  headers=new List<IAccessible>();anchors=new List<IAccessible>();viewport=null;tab=null;IAccessible previous=null;
  var nodes=new object[count];int got;if(AccessibleChildren(root,0,count,nodes,out got)!=0||got!=count)throw new Exception("INCOMPLETE_PANEL");
  foreach(var item in nodes){if(timer.ElapsedMilliseconds>5000)throw new Exception("SCROLL_PREFLIGHT_TIMEOUT");var node=item as IAccessible;if(node==null)throw new Exception("UNSUPPORTED_CHILD");var name=Name(node);
   if(name==r.tab&&(State(node)&8)!=0){if(tab!=null)throw new Exception("AMBIGUOUS_TARGET");tab=node;}
   if(name=="UI_ScrollBar"){if(viewport!=null)throw new Exception("AMBIGUOUS_SCROLLBAR");viewport=node;}
   if((name=="효과 켜기/끄기"||name=="Toggle the effect on or off")&&previous!=null){if(Convert.ToInt32(previous.get_accRole(0))!=43)throw new Exception("HEADER_ROLE_CHANGED");headers.Add(previous);anchors.Add(node);}
   previous=node;
  }
  }
  if(headers.Count!=r.headerCount||viewport==null||tab==null||(State(tab)&(1|32768|65536))!=0)throw new Exception("EFFECT_LAYOUT_UNVERIFIED");
  var target=headers[r.headerIndex];if((State(target)&8)==0)throw new Exception("EFFECT_COLLAPSED");
  var geometry=r.initialRowsHeight==21?anchors[r.headerIndex]:target;
  int x,y,w,height;viewport.accLocation(out x,out y,out w,out height,0);int top=y,bottom=y+height,px=x+w/2,py=y+height/2;
  if(px< -32768||py< -32768||px>32767||py>32767||height<100||w<1)throw new Exception("UNSUPPORTED_VIEWPORT");
  int viewportX=x,viewportY=y,viewportWidth=w,viewportHeight=height;
  var before=viewport.get_accValue(0);int steps=0;bool reset=false,visible=false;
  for(int i=0;i<64;i++){
   int nx,ny,nw,nh;viewport.accLocation(out nx,out ny,out nw,out nh,0);
   if(nx!=viewportX||ny!=viewportY||nw!=viewportWidth||nh!=viewportHeight)throw new Exception("EFFECT_VIEWPORT_RESIZED");
   if(timer.ElapsedMilliseconds>8500)throw new Exception("SCROLL_BUDGET_EXHAUSTED");if(Name(tab)!=r.tab||(State(tab)&8)==0)throw new Exception("TARGET_CHANGED");
   geometry.accLocation(out x,out y,out w,out height,0);int state=State(geometry);
   int initialRowsHeight=r.initialRowsHeight;
   visible=(state&(1|32768|65536))==0&&(State(target)&8)!=0&&y>=top+4&&y+initialRowsHeight<=bottom;
   if(visible)break;
   dispatched=true;
   if(!reset){Scroll(h,px,py,2880);reset=true;}else Scroll(h,px,py,-120);
   steps++;
  }
  Console.Write(json.Serialize(new {protocol=1,status="unverified",route="windows_directed_effect_scroll",premierePid=r.pid,panelHandle=r.handle,selectedClipTab=r.tab,headerIndex=r.headerIndex,dispatchAccepted=dispatched,steps,before,after=viewport.get_accValue(0),sectionVisible=visible,indexedPreflight=indexed,elapsedMs=timer.ElapsedMilliseconds}));return 0;
 }catch(Exception e){Console.Write(json.Serialize(new {status=dispatched?"unverified":"unsupported",route="windows_directed_effect_scroll",dispatchAccepted=dispatched,reason=e.Message}));return 1;}}
}
