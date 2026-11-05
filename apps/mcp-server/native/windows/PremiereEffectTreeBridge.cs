using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Accessibility;

// Read every visible native disclosure through an overlapping viewport sweep.
// Only directed scrolling is dispatched. Never clicks, keys, or pointer input.
class PremiereEffectTreeBridge {
 internal class Request {public int pid {get;set;}public long handle {get;set;}public string tab {get;set;}public int expandedDepth {get;set;}}
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
 static string Name(IAccessible a){try{return a.get_accName(0);}catch{return null;}}
 static int State(IAccessible a){return Convert.ToInt32(a.get_accState(0));}
 static void Scroll(IntPtr h,int x,int y,int delta){IntPtr result;if(SendMessageTimeout(h,0x020A,new IntPtr(delta<<16),new IntPtr((y<<16)|(x&65535)),2,600,out result)==IntPtr.Zero)throw new Exception("SCROLL_UNVERIFIED");Thread.Sleep(50);}
 internal class Row {public int index,state,left,top,width,height,depth;public string name;public bool expanded;}
 public static int Main(string[] args){Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();try{
  if(args.Length!=1)throw new Exception("INVALID_TREE_REQUEST");
  var r=json.Deserialize<Request>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
  if(args.Length!=1||r.pid<=0||r.handle<=0||String.IsNullOrEmpty(r.tab)||r.tab.Length>1800||r.expandedDepth< -1||r.expandedDepth>8)throw new Exception("INVALID_TREE_REQUEST");
  var process=Process.GetProcessById(r.pid);var version=FileVersionInfo.GetVersionInfo(process.MainModule.FileName);
  if(process.ProcessName!="Adobe Premiere Pro"||version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("PREMIERE_VERSION_UNVERIFIED");
  var h=new IntPtr(r.handle);uint owner;GetWindowThreadProcessId(h,out owner);if(owner!=r.pid)throw new Exception("PROCESS_CHANGED");
  var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object raw;if(AccessibleObjectFromWindow(h,0xFFFFFFFC,ref iid,out raw)!=0)throw new Exception("PANEL_MISSING");var root=(IAccessible)raw;
  if(Name(root)!="Effect Controls")throw new Exception("PANEL_CHANGED");int count=root.accChildCount;if(count<1||count>2048)throw new Exception("TREE_UNBOUNDED");
  var nodes=new List<IAccessible>();var names=new List<string>();IAccessible tab=null,viewport=null;var watch=Stopwatch.StartNew();
  for(int i=0;i<count;i++){var n=root.get_accChild(i+1) as IAccessible;if(n==null)throw new Exception("CHILD_UNSUPPORTED");nodes.Add(n);names.Add(Name(n));if(names[i]==r.tab&&(State(n)&8)!=0){if(tab!=null)throw new Exception("TAB_AMBIGUOUS");tab=n;}if(names[i]=="UI_ScrollBar"){if(viewport!=null)throw new Exception("VIEWPORT_AMBIGUOUS");viewport=n;}}
  if(tab==null||viewport==null)throw new Exception("TARGET_MISSING");
  int vx,vy,vw,vh;viewport.accLocation(out vx,out vy,out vw,out vh,0);int px=vx+vw/2,py=vy+vh/2;
  if(vh<100||px< -32768||py< -32768||px>32767||py>32767)throw new Exception("VIEWPORT_INVALID");
  var indices=new List<int>();for(int i=0;i<count;i++)if(names[i]=="UI_DisclosureTriangleButton"||(i+1<count&&(names[i+1]=="효과 켜기/끄기"||names[i+1]=="Toggle the effect on or off")))indices.Add(i);
  if(indices.Count<3||indices.Count>256)throw new Exception("DISCLOSURE_COUNT_UNVERIFIED");
  Scroll(h,px,py,28800);var observed=new Dictionary<int,Row>();bool complete=false;int pages=0;
  for(int page=0;page<80;page++){
   if(watch.ElapsedMilliseconds>18000)throw new Exception("TREE_SWEEP_BUDGET");if(root.accChildCount>2048||Name(tab)!=r.tab||(State(tab)&8)==0)throw new Exception("TREE_CHANGED");
   int currentX,currentY,currentW,currentH;viewport.accLocation(out currentX,out currentY,out currentW,out currentH,0);
   if(currentX!=vx||currentY!=vy||currentW!=vw||currentH!=vh)throw new Exception("PANEL_LAYOUT_CHANGED_REINSPECT");
   foreach(int index in indices){var n=nodes[index];int state=State(n),x,y,w,height;n.accLocation(out x,out y,out w,out height,0);
    if((state&(1|32768|65536))!=0||y<vy||y+height>vy+vh||height<1)continue;
    if(Convert.ToInt32(n.get_accRole(0))!=43)throw new Exception("DISCLOSURE_ROLE_CHANGED");
    observed[index]=new Row {index=index,state=state,left=x,top=y,width=w,height=height,name=Name(n),expanded=(state&8)!=0};
   }
   pages++;string before=viewport.get_accValue(0);Scroll(h,px,py,-480);if(viewport.get_accValue(0)==before){complete=true;break;}
  }
  if(!complete||observed.Count<3)throw new Exception("TREE_SWEEP_INCOMPLETE");
  int left=Int32.MaxValue,unit=0;foreach(var row in observed.Values){left=Math.Min(left,row.left);if(row.width!=row.height||row.width<10||row.width>40||(unit!=0&&row.width!=unit))throw new Exception("DISCLOSURE_SCALE_UNVERIFIED");unit=row.width;}
  var errors=new List<string>();foreach(var row in observed.Values){int offset=row.left-left;if(offset%unit!=0||offset<0||offset>8*unit)throw new Exception("NATIVE_INDENT_UNVERIFIED");row.depth=offset/unit;if(row.expanded!=(row.depth<=r.expandedDepth))errors.Add("depth="+row.depth+",index="+row.index+",expanded="+row.expanded);}
  Console.Write(json.Serialize(new {protocol=1,status=errors.Count==0?"pass":"unverified",route="windows_msaa_effect_tree",premierePid=r.pid,panelHandle=r.handle,selectedClipTab=r.tab,expandedDepth=r.expandedDepth,complete=true,pages,rows=observed.Values,errors,elapsedMs=watch.ElapsedMilliseconds}));return 0;
 }catch(Exception e){Console.Write(json.Serialize(new {status="unverified",route="windows_msaa_effect_tree",reason=e.Message}));return 1;}}
}
