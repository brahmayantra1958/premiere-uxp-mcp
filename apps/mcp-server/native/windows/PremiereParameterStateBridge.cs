using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Accessibility;

// A causally bound parameter triangle within one already verified effect.
// Reads fresh native state; the sole action is directed pane scrolling.
internal static class PremiereParameterStateBridge {
 internal static bool WorkerMode=false;
 internal sealed class Hints {public long handle {get;set;}public int count {get;set;}public int tab {get;set;}public int viewport {get;set;}public int[] headers {get;set;}}
 internal sealed class Request {public int pid {get;set;}public string tab {get;set;}public Hints hints {get;set;}public int headerIndex {get;set;}public int? ordinal {get;set;}public int[] indices {get;set;}public bool scroll {get;set;}public bool pointValueControls {get;set;}public bool customGraph {get;set;}public bool colorRow {get;set;}public int parameterCount {get;set;}public int[] colorIndices {get;set;}public bool timeVarying {get;set;}public bool speedRow {get;set;}}
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible root,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]object[] children,out int obtained);
 // One native enumeration replaces a cross-process get_accChild for every
 // element. Names/roles/state remain fresh and exact scope/count are checked.
 static IAccessible[] Children(IAccessible root,int start,int end,int count){
  if(start<0||end<start||end>count||root.accChildCount!=count)throw new Exception("PARAMETER_LAYOUT_CHANGED");
  var raw=new object[end-start];int obtained;
  if(AccessibleChildren(root,start,raw.Length,raw,out obtained)<0||obtained!=raw.Length||root.accChildCount!=count)throw new Exception("PARAMETER_CHILDREN_INCOMPLETE");
  var nodes=new IAccessible[raw.Length];for(int i=0;i<raw.Length;i++){nodes[i]=raw[i] as IAccessible;if(nodes[i]==null)throw new Exception("PARAMETER_NODE_UNSUPPORTED");}return nodes;
 }
 static string Name(IAccessible n){try{return n.get_accName(0);}catch{return null;}}
 static int State(IAccessible n){return Convert.ToInt32(n.get_accState(0));}
 static bool Enable(string n){return n=="효과 켜기/끄기"||n=="Toggle the effect on or off";}
 static IAccessible Child(IAccessible n,int index,int count){if(index<0||index>=count)throw new Exception("PARAMETER_INDEX_CHANGED");var c=n.get_accChild(index+1) as IAccessible;if(c==null)throw new Exception("PARAMETER_NODE_UNSUPPORTED");return c;}
 static Dictionary<string,object> Row(IAccessible n,int index,int ordinal){int x,y,w,h;n.accLocation(out x,out y,out w,out h,0);return new Dictionary<string,object>{{"index",index},{"ordinal",ordinal},{"role",Convert.ToInt32(n.get_accRole(0))},{"state",State(n)},{"name",Name(n)},{"left",x},{"top",y},{"width",w},{"height",h}};}
 static void StableViewport(Request r,IAccessible root,IntPtr h,int x,int y,int width,int height){
  uint pid;GetWindowThreadProcessId(h,out pid);
  if(pid!=r.pid||!IsWindowVisible(h)||root.accChildCount!=r.hints.count)throw new Exception("PARAMETER_LAYOUT_CHANGED_AT_RETURN");
  var tab=Child(root,r.hints.tab,r.hints.count);if(Name(tab)!=r.tab||(State(tab)&8)==0)throw new Exception("PARAMETER_CLIP_CHANGED_AT_RETURN");
  var viewport=Child(root,r.hints.viewport,r.hints.count);int nx,ny,nw,nh;viewport.accLocation(out nx,out ny,out nw,out nh,0);
  if(Name(viewport)!="UI_ScrollBar"||nx!=x||ny!=y||nw!=width||nh!=height)throw new Exception("PARAMETER_VIEWPORT_RESIZED");
 }
 // Some native Point rows keep an invisible disclosure node but always draw
 // their two coordinates inline. The isolated property transition still binds
 // the row; its fresh, adjacent value controls prove actual presentation.
 static List<Dictionary<string,object>> PointControls(IAccessible root,int index,int end,int count,int rowTop){
  var result=new List<Dictionary<string,object>>();
  for(int i=index+1;i<Math.Min(end,index+25);i++){var n=Child(root,i,count);if(Name(n)!="UI_HotText"||Convert.ToInt32(n.get_accRole(0))!=42)continue;
   var row=Row(n,i,0);if(Math.Abs((int)row["top"]-rowTop)>4)continue;try{row["value"]=n.get_accValue(0);}catch{row["value"]=null;}result.Add(row);
  }return result.Count==2?result:null;
 }
 static bool PointVisible(List<Dictionary<string,object>> controls,int top,int height){
  if(controls==null)return false;foreach(var c in controls)if(((int)c["state"]&(1|32768|65536))!=0||(int)c["width"]<=0||(int)c["height"]<=0||(int)c["top"]<top+4||(int)c["top"]+(int)c["height"]>top+height||String.IsNullOrEmpty(c["value"] as string))return false;return true;
 }
 static bool Animation(string name){return name=="애니메이션 켜기/끄기"||name=="Toggle animation";}
 // Hue-family custom graphs paint no accessible child. Their following native
 // reset row marks the lower edge before the next disclosure. Use fresh host
 // geometry, never a fixed graph height or coordinates from a screenshot.
 static Dictionary<string,object> CustomBoundary(IAccessible root,int index,int end,int count,int top){
  for(int i=index+1;i<Math.Min(end,index+32);i++){
   var n=Child(root,i,count);string name=Name(n);if(name!="매개 변수 재설정"&&name!="Reset Parameter")continue;
   var row=Row(n,i,0);if((int)row["role"]==43&&(int)row["top"]>top+42&&(int)row["height"]>0)return row;
  }
  // RGB curves have no intermediate following reset row. The next disclosure
  // is their native lower boundary; accept only its actual non-placeholder
  // geometry while it is visible. An oversized graph remains unverified.
  if(end<count&&end<index+32){var n=Child(root,end,count);var row=Row(n,end,0);if(Name(n)=="UI_DisclosureTriangleButton"&&(int)row["role"]==43&&((int)row["state"]&(1|32768|65536))==0&&(int)row["top"]>top+42&&(int)row["height"]>0)return row;}
  return null;
 }
 static bool CustomVisible(Dictionary<string,object> boundary,int top,int viewportTop,int viewportHeight){
  return boundary!=null&&top>=viewportTop+4&&(int)boundary["top"]<=viewportTop+viewportHeight-4;
 }
 // Scrolling may lazily reconstruct Color key controls. Rebind the complete
 // scope, retaining header order/state and exact selected tab. No saved native
 // child index survives a change in the accessible child count.
 static void RefreshColorLayout(Request r,IAccessible root,int[] states,Stopwatch timer){
  int count=root.accChildCount;if(count<1||count>16384)throw new Exception("COLOR_LAYOUT_UNBOUNDED");
  var all=new List<IAccessible>();var headers=new List<int>();int tab=-1,viewport=-1;
  var children=Children(root,0,count,count);
  var names=PremiereEffectStateBridge.ReadNames(root,0,children.Length,timer,12000);
  for(int i=0;i<count;i++){
   if(timer.ElapsedMilliseconds>14000)throw new Exception("COLOR_ROW_SCROLL_BUDGET");
   var n=children[i];all.Add(n);string name=names[i];
   if(name==r.tab&&(State(n)&8)!=0){if(tab!=-1)throw new Exception("COLOR_TAB_AMBIGUOUS");tab=i;}
   if(name=="UI_ScrollBar"){if(viewport!=-1)throw new Exception("COLOR_VIEWPORT_AMBIGUOUS");viewport=i;}
   if(i>0&&Enable(name)&&Convert.ToInt32(all[i-1].get_accRole(0))==43)headers.Add(i-1);
  }
  if(count!=root.accChildCount||tab<0||viewport<0||headers.Count!=states.Length)throw new Exception("COLOR_ROW_LAYOUT_CHANGED");
  for(int i=0;i<headers.Count;i++)if((State(all[headers[i]])&8)!=states[i])throw new Exception("COLOR_EFFECT_VECTOR_CHANGED");
  r.hints.count=count;r.hints.tab=tab;r.hints.viewport=viewport;r.hints.headers=headers.ToArray();
 }
 static List<int> BindColorRows(Request r,IAccessible root,int start,int end,Stopwatch timer){
  var indices=new List<int>();var wanted=new HashSet<int>(r.colorIndices);
  for(int i=start;i<end;i++){
   if(timer.ElapsedMilliseconds>14000)throw new Exception("COLOR_ROW_READ_BUDGET");var node=Child(root,i,r.hints.count);
   if(!Animation(Name(node)))continue;if(Convert.ToInt32(node.get_accRole(0))!=43||i==start)throw new Exception("COLOR_ROW_ROLE_CHANGED");
   var prefix=Child(root,i-1,r.hints.count);bool color=Convert.ToInt32(prefix.get_accRole(0))==41&&String.IsNullOrEmpty(Name(prefix));
   if(color!=wanted.Contains(indices.Count))throw new Exception("COLOR_ROW_SHAPE_CHANGED");indices.Add(i);
  }
  if(indices.Count!=r.parameterCount)throw new Exception("COLOR_ROW_COUNT_CHANGED");return indices;
 }
 // Color swatches are custom-painted, with no disclosure triangle. Bind only
 // when the complete native animation-row count and Color placeholder vector
 // agree with the exact UXP parameter definition. Prove the row through its
 // animation/key-navigation/reset controls, never invent an expanded arrow.
 static object ColorRows(Request r,IAccessible root,IntPtr h,int start,int end,ref bool dispatched){
  if(r.parameterCount<1||r.parameterCount>64||r.colorIndices==null||r.colorIndices.Length<1||r.colorIndices.Length>r.parameterCount||!r.ordinal.HasValue||Array.IndexOf(r.colorIndices,r.ordinal.Value)<0)throw new Exception("COLOR_ROW_SCOPE_INVALID");
  var wanted=new HashSet<int>();int previous=-1;foreach(int i in r.colorIndices){if(i<=previous||i>=r.parameterCount)throw new Exception("COLOR_ROW_DEFINITION_CHANGED");previous=i;wanted.Add(i);}
  var hint=r.hints;var timer=Stopwatch.StartNew();var indices=new List<int>();var observedColors=new List<int>();
  for(int i=start;i<end;i++){
   if(timer.ElapsedMilliseconds>3500)throw new Exception("COLOR_ROW_READ_BUDGET");var node=Child(root,i,hint.count);
   if(!Animation(Name(node)))continue;if(Convert.ToInt32(node.get_accRole(0))!=43||i==start)throw new Exception("COLOR_ROW_ROLE_CHANGED");
   var prefix=Child(root,i-1,hint.count);bool color=Convert.ToInt32(prefix.get_accRole(0))==41&&String.IsNullOrEmpty(Name(prefix));
   if(color)observedColors.Add(indices.Count);if(color!=wanted.Contains(indices.Count))throw new Exception("COLOR_ROW_SHAPE_CHANGED");indices.Add(i);
  }
  if(indices.Count!=r.parameterCount||observedColors.Count!=wanted.Count||r.ordinal.Value>=indices.Count)throw new Exception("COLOR_ROW_COUNT_CHANGED");
  int targetIndex=indices[r.ordinal.Value];if(targetIndex+4>=end)throw new Exception("COLOR_ROW_BOUNDARY_CHANGED");
  var viewport=Child(root,hint.viewport,hint.count);int vx,vy,vw,vh;viewport.accLocation(out vx,out vy,out vw,out vh,0);
  if(Name(viewport)!="UI_ScrollBar"||vh<80||vw<1)throw new Exception("COLOR_VIEWPORT_CHANGED");int px=vx+vw/2,py=vy+vh/2;
  if(px< -32768||py< -32768||px>32767||py>32767)throw new Exception("COLOR_VIEWPORT_COORDINATES");
  int steps=0,rebindings=0;var headerStates=new int[hint.headers.Length];for(int i=0;i<headerStates.Length;i++)headerStates[i]=State(Child(root,hint.headers[i],hint.count))&8;
  var controls=new List<Dictionary<string,object>>();Dictionary<string,object> row=null;
  for(int iteration=0;iteration<65;iteration++){
   if(root.accChildCount!=hint.count){
    if(++rebindings>4)throw new Exception("COLOR_LAYOUT_CHANGED_REPEATEDLY");RefreshColorLayout(r,root,headerStates,timer);
    start=hint.headers[r.headerIndex]+1;end=r.headerIndex+1<hint.headers.Length?hint.headers[r.headerIndex+1]:hint.count;
    indices=BindColorRows(r,root,start,end,timer);targetIndex=indices[r.ordinal.Value];
    if(targetIndex+4>=end)throw new Exception("COLOR_ROW_BOUNDARY_CHANGED");
   }
   if(root.accChildCount!=hint.count||Name(Child(root,hint.tab,hint.count))!=r.tab||(State(Child(root,hint.tab,hint.count))&8)==0)throw new Exception("COLOR_ROW_LAYOUT_CHANGED");
   var target=Child(root,targetIndex,hint.count);if(!Animation(Name(target))||((State(target)&8)!=0)!=r.timeVarying)throw new Exception("COLOR_ROW_ANIMATION_CHANGED");
   row=Row(target,targetIndex,r.ordinal.Value);controls.Clear();
   for(int j=1;j<=4;j++){var control=Row(Child(root,targetIndex+j,hint.count),targetIndex+j,0);if((int)control["role"]!=43)throw new Exception("COLOR_ROW_CONTROL_CHANGED");controls.Add(control);}
   string[][] labels={new[]{"이전 키프레임으로 이동","Go to previous keyframe"},new[]{"다음 키프레임으로 이동","Go to next keyframe"},new[]{"키프레임 추가/제거","Add/Remove Keyframe"},new[]{"매개 변수 재설정","Reset Parameter"}};
   bool visible=((int)row["state"]&(1|32768|65536))==0&&(int)row["height"]>0&&(int)row["width"]>0&&(int)row["top"]>=vy+4&&(int)row["top"]+(int)row["height"]<=vy+vh;
   for(int j=0;j<4;j++){var c=controls[j];if(Array.IndexOf(labels[j],c["name"] as string)<0)throw new Exception("COLOR_ROW_CONTROL_CHANGED");visible=visible&&((int)c["state"]&(32768|65536))==0&&(int)c["height"]>0&&(int)c["width"]>0&&Math.Abs((int)c["top"]-(int)row["top"])<=4&&(int)c["top"]>=vy+4&&(int)c["top"]+(int)c["height"]<=vy+vh;}
   if(visible||!r.scroll||iteration==64)break;if(timer.ElapsedMilliseconds>14000)throw new Exception("COLOR_ROW_SCROLL_BUDGET");
   IntPtr result;int delta=iteration==0?28800:-120;dispatched=true;
   if(SendMessageTimeout(h,0x020A,new IntPtr(delta<<16),new IntPtr((py<<16)|(px&65535)),2,600,out result)==IntPtr.Zero)throw new Exception("COLOR_ROW_SCROLL_UNVERIFIED");Thread.Sleep(30);steps++;
   viewport=Child(root,hint.viewport,hint.count);int nx,ny,nw,nh;viewport.accLocation(out nx,out ny,out nw,out nh,0);if(nx!=vx||ny!=vy||nw!=vw||nh!=vh)throw new Exception("COLOR_VIEWPORT_RESIZED");
  }
  row["inlineColorControls"]=controls;var rows=new List<object>();for(int i=0;i<indices.Count;i++)rows.Add(i==r.ordinal.Value?(object)row:Row(Child(root,indices[i],hint.count),indices[i],i));
  StableViewport(r,root,h,vx,vy,vw,vh);
  return new {protocol=1,status="pass",route="windows_msaa_parameter_state",premierePid=r.pid,panelHandle=hint.handle,selectedClipTab=r.tab,headerIndex=r.headerIndex,rows,viewport=new {left=vx,top=vy,width=vw,height=vh},rowMapping=new {method="complete_native_parameter_rows",parameterCount=r.parameterCount,colorIndices=observedColors},dispatchAccepted=dispatched,steps,rebindings,elapsedMs=timer.ElapsedMilliseconds};
 }
 public static int Main(string[] args){if(!WorkerMode)Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();bool dispatched=false;var progress=new Dictionary<string,object>();try{
  if(args.Length!=1)throw new Exception("PARAMETER_REQUEST_INVALID");var r=json.Deserialize<Request>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));var hint=r.hints;
  if(r.pid<=0||String.IsNullOrEmpty(r.tab)||r.tab.Length>1800||hint==null||hint.headers==null||hint.headers.Length>128||r.headerIndex<0||r.headerIndex>=hint.headers.Length||hint.count<1||hint.count>16384)throw new Exception("PARAMETER_SCOPE_INVALID");
  var p=Process.GetProcessById(r.pid);var version=FileVersionInfo.GetVersionInfo(p.MainModule.FileName);if(p.ProcessName!="Adobe Premiere Pro"||version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("PARAMETER_VERSION_UNVERIFIED");
  var h=new IntPtr(hint.handle);uint owner;GetWindowThreadProcessId(h,out owner);if(owner!=r.pid||!IsWindowVisible(h))throw new Exception("PARAMETER_WINDOW_CHANGED");
  var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object raw;if(AccessibleObjectFromWindow(h,0xFFFFFFFC,ref iid,out raw)!=0)throw new Exception("PARAMETER_PANEL_MISSING");var root=(IAccessible)raw;
  if(Name(root)!="Effect Controls"||root.accChildCount!=hint.count)throw new Exception("PARAMETER_LAYOUT_CHANGED");
  var tab=Child(root,hint.tab,hint.count);if(Name(tab)!=r.tab||(State(tab)&8)==0)throw new Exception("PARAMETER_CLIP_CHANGED");
  foreach(int i in hint.headers)if(Convert.ToInt32(Child(root,i,hint.count).get_accRole(0))!=43||!Enable(Name(Child(root,i+1,hint.count))))throw new Exception("PARAMETER_EFFECT_CHANGED");
  var header=Child(root,hint.headers[r.headerIndex],hint.count);if((State(header)&8)==0)throw new Exception("PARAMETER_EFFECT_COLLAPSED");
  var viewport=Child(root,hint.viewport,hint.count);if(Name(viewport)!="UI_ScrollBar")throw new Exception("PARAMETER_VIEWPORT_CHANGED");
  int start=hint.headers[r.headerIndex]+1,end=r.headerIndex+1<hint.headers.Length?hint.headers[r.headerIndex+1]:hint.count;
  if(r.colorRow){Console.Write(json.Serialize(ColorRows(r,root,h,start,end,ref dispatched)));return 0;}
  var nodes=new List<IAccessible>();var indices=new List<int>();var timer=Stopwatch.StartNew();
  if(r.indices!=null){
    if(r.indices.Length>512)throw new Exception("PARAMETER_HINTS_UNBOUNDED");int previous=start-1;
    foreach(int i in r.indices){if(i<=previous||i<start||i>=end)throw new Exception("PARAMETER_HINTS_CHANGED");indices.Add(i);previous=i;}
    // Sparse hints avoid marshaling the many unrelated value widgets between
    // triangles. A read needs one fresh pass, scrolling also needs a pre-state.
    foreach(int i in indices)nodes.Add(r.scroll?Child(root,i,hint.count):null);
  }else {var children=Children(root,start,end,hint.count);for(int i=start;i<end;i++){if(timer.ElapsedMilliseconds>3500)throw new Exception("PARAMETER_READ_BUDGET");var n=children[i-start];if(Name(n)=="UI_DisclosureTriangleButton"){if(Convert.ToInt32(n.get_accRole(0))!=43)throw new Exception("PARAMETER_ROLE_CHANGED");indices.Add(i);nodes.Add(n);}}}
  if(nodes.Count>512||r.ordinal.HasValue&&(r.ordinal.Value<0||r.ordinal.Value>=nodes.Count))throw new Exception("PARAMETER_ORDINAL_CHANGED");
  int vx,vy,vw,vh;viewport.accLocation(out vx,out vy,out vw,out vh,0);if(vh<80||vw<1)throw new Exception("PARAMETER_VIEWPORT_INVALID");int steps=0,rebindings=0;
  var disclosureStates=new List<int>();if(r.scroll)foreach(var node in nodes){if(Name(node)!="UI_DisclosureTriangleButton"||Convert.ToInt32(node.get_accRole(0))!=43)throw new Exception("PARAMETER_HINTS_CHANGED");disclosureStates.Add(State(node)&8);}
  if(r.scroll){
    if(!r.ordinal.HasValue)throw new Exception("PARAMETER_BINDING_REQUIRED");var target=nodes[r.ordinal.Value];int px=vx+vw/2,py=vy+vh/2;
    if(px< -32768||py< -32768||px>32767||py>32767)throw new Exception("PARAMETER_VIEWPORT_COORDINATES");
    bool reset=false;for(int i=0;i<64;i++){
      if(root.accChildCount!=hint.count){
        // Audio graphs lazily create/remove ordinary controls when scrolled.
        // Reacquire nodes only if the selected tab, effect-header order and
        // entire disclosure vector are unchanged. Never keep stale indices.
        if(++rebindings>4)throw new Exception("PARAMETER_LAYOUT_CHANGED_REPEATEDLY");
        int newCount=root.accChildCount;if(newCount<1||newCount>16384)throw new Exception("PARAMETER_LAYOUT_CHANGED_UNBOUNDED");
        var all=new List<IAccessible>();var names=new List<string>();var headers=new List<int>();IAccessible newTab=null,newViewport=null;int newTabIndex=-1,newViewportIndex=-1;
        var children=Children(root,0,newCount,newCount);
        var freshNames=PremiereEffectStateBridge.ReadNames(root,0,children.Length,timer,12000);
        for(int j=0;j<newCount;j++){
          if(timer.ElapsedMilliseconds>14000)throw new Exception("PARAMETER_SCROLL_BUDGET");var n=children[j];all.Add(n);names.Add(freshNames[j]);
          if(names[j]==r.tab&&(State(n)&8)!=0){if(newTab!=null)throw new Exception("PARAMETER_TAB_AMBIGUOUS");newTab=n;newTabIndex=j;}
          if(names[j]=="UI_ScrollBar"){if(newViewport!=null)throw new Exception("PARAMETER_VIEWPORT_AMBIGUOUS");newViewport=n;newViewportIndex=j;}
          if(j>0&&Enable(names[j])&&Convert.ToInt32(all[j-1].get_accRole(0))==43)headers.Add(j-1);
        }
        if(root.accChildCount!=newCount||newTab==null||newViewport==null||headers.Count!=hint.headers.Length)throw new Exception("PARAMETER_LAYOUT_CHANGED");
        if((State(all[headers[r.headerIndex]])&8)==0)throw new Exception("PARAMETER_EFFECT_COLLAPSED");
        int first=headers[r.headerIndex]+1,last=r.headerIndex+1<headers.Count?headers[r.headerIndex+1]:newCount;
        var freshNodes=new List<IAccessible>();var freshIndices=new List<int>();
        for(int j=first;j<last;j++)if(names[j]=="UI_DisclosureTriangleButton"){
          int ordinal=freshNodes.Count;if(ordinal>=disclosureStates.Count||Convert.ToInt32(all[j].get_accRole(0))!=43||(State(all[j])&8)!=disclosureStates[ordinal])throw new Exception("PARAMETER_DISCLOSURE_VECTOR_CHANGED");freshNodes.Add(all[j]);freshIndices.Add(j);
        }
        if(freshNodes.Count!=nodes.Count)throw new Exception("PARAMETER_DISCLOSURE_VECTOR_CHANGED");
        nodes=freshNodes;indices=freshIndices;tab=newTab;viewport=newViewport;hint.count=newCount;hint.headers=headers.ToArray();hint.tab=newTabIndex;hint.viewport=newViewportIndex;target=nodes[r.ordinal.Value];
      }
      // Premiere can replace accessible children without changing their count
      // (notably when a Point graph is materialized). A retained COM object can
      // then report a stale INVISIBLE bit and location throughout a full sweep.
      // Reacquire the causally bound row, selected tab and viewport by their
      // validated indices on every iteration; never infer visibility from age.
      tab=Child(root,hint.tab,hint.count);viewport=Child(root,hint.viewport,hint.count);
      target=Child(root,indices[r.ordinal.Value],hint.count);nodes[r.ordinal.Value]=target;
      if(Name(target)!="UI_DisclosureTriangleButton"||Convert.ToInt32(target.get_accRole(0))!=43||(State(target)&8)!=disclosureStates[r.ordinal.Value])throw new Exception("PARAMETER_DISCLOSURE_VECTOR_CHANGED");
      if(Name(viewport)!="UI_ScrollBar")throw new Exception("PARAMETER_VIEWPORT_CHANGED");
      if(Name(tab)!=r.tab||(State(tab)&8)==0)throw new Exception("PARAMETER_CLIP_CHANGED_DURING_SCROLL");
      int x,y,w,height;target.accLocation(out x,out y,out w,out height,0);int state=State(target);
      progress["steps"]=steps;progress["rebindings"]=rebindings;progress["elapsedMs"]=timer.ElapsedMilliseconds;progress["targetTop"]=y;progress["targetState"]=state;progress["viewportTop"]=vy;progress["viewportHeight"]=vh;
      int parameterEnd=r.ordinal.Value+1<indices.Count?indices[r.ordinal.Value+1]:(r.headerIndex+1<hint.headers.Length?hint.headers[r.headerIndex+1]:hint.count);
      if((state&(1|32768|65536))==0&&y>=vy+4&&y+42<=vy+vh&&(!r.customGraph||CustomVisible(CustomBoundary(root,indices[r.ordinal.Value],parameterEnd,hint.count,y),y,vy,vh)))break;
      if(r.pointValueControls&&(state&32768)!=0&&(state&1)==0&&PointVisible(PointControls(root,indices[r.ordinal.Value],parameterEnd,hint.count,y),vy,vh))break;
      if(timer.ElapsedMilliseconds>14000)throw new Exception("PARAMETER_SCROLL_BUDGET");
      // Premiere uses INVISIBLE for offscreen rows too. Only a bounded sweep,
      // not this flag alone, can distinguish an offscreen row from a closed group.
      // If the exact target is already visible, retain that progress instead of
      // resetting to the top. Offscreen travel uses three wheel increments;
      // this is smaller than the observed viewport. Once visible, fine steps
      // fit the graph's independently measured bottom boundary into the pane.
      // A visible heading near the bottom is not a visible graph. Move it into
      // the upper third in coarse increments too; otherwise every tiny move can
      // trigger another full lazy-tree reconstruction. If we pass the top edge,
      // correct upwards rather than continuing an irreversible downward sweep.
      if(!reset&&(state&(1|32768|65536))==0&&y>=vy&&y<vy+vh)reset=true;
      bool onScreen=(state&(32768|65536))==0;
      int delta=!reset?28800:onScreen&&y<vy+4?120:vh>=300&&(!onScreen||r.customGraph&&y>vy+vh/3)?-360:-120;reset=true;IntPtr result;dispatched=true;
      if(SendMessageTimeout(h,0x020A,new IntPtr(delta<<16),new IntPtr((py<<16)|(px&65535)),2,600,out result)==IntPtr.Zero)throw new Exception("PARAMETER_SCROLL_UNVERIFIED");Thread.Sleep(30);steps++;
      int nx,ny,nw,nh;viewport.accLocation(out nx,out ny,out nw,out nh,0);if(nx!=vx||ny!=vy||nw!=vw||nh!=vh)throw new Exception("PARAMETER_VIEWPORT_RESIZED");
    }
  }
  var rows=new List<object>();for(int i=0;i<nodes.Count;i++){
   if(r.scroll||r.indices!=null)nodes[i]=Child(root,indices[i],hint.count);
   string rowName=Name(nodes[i]);int rowRole=Convert.ToInt32(nodes[i].get_accRole(0)),rowState=State(nodes[i]);
   if(rowName!="UI_DisclosureTriangleButton"||rowRole!=43||r.scroll&&(rowState&8)!=disclosureStates[i])throw new Exception("PARAMETER_LAYOUT_CHANGED_AT_RETURN");
   if(r.ordinal.HasValue&&r.ordinal.Value==i){int rx,ry,rw,rh;nodes[i].accLocation(out rx,out ry,out rw,out rh,0);var row=new Dictionary<string,object>{{"index",indices[i]},{"ordinal",i},{"role",rowRole},{"state",rowState},{"name",rowName},{"left",rx},{"top",ry},{"width",rw},{"height",rh}};
    // The caller has independently bound the unique Time Remapping section.
    // Read its native animation label to preserve Premiere's actual UI language.
    // When open, also expose the graph annotation; a moving arrow alone cannot
    // prove that a temporary parameter kept its visible Speed name.
    if(r.speedRow){
     int sectionEnd=r.headerIndex+1<hint.headers.Length?hint.headers[r.headerIndex+1]:hint.count;
     if(nodes.Count!=1||i!=0||indices[i]+1>=sectionEnd)throw new Exception("SPEED_ROW_SCOPE_CHANGED");
     var animation=Row(Child(root,indices[i]+1,hint.count),indices[i]+1,0);
     if((int)animation["role"]!=43||!Animation(animation["name"] as string))throw new Exception("SPEED_ROW_ANIMATION_UNVERIFIED");
     row["animationControl"]=animation;
     var labels=new List<object>();
     if(((int)row["state"]&8)!=0)for(int j=indices[i]+2;j<Math.Min(sectionEnd,indices[i]+17);j++){
      var candidate=Row(Child(root,j,hint.count),j,0);string name=candidate["name"] as string;
      if((int)candidate["role"]==41&&!String.IsNullOrEmpty(name)&&name.Contains(":"))labels.Add(candidate);
     }
     row["graphLabels"]=labels;
    }
    if(r.customGraph){int graphEnd=i+1<indices.Count?indices[i+1]:(r.headerIndex+1<hint.headers.Length?hint.headers[r.headerIndex+1]:hint.count);var boundary=CustomBoundary(root,indices[i],graphEnd,hint.count,(int)row["top"]);if(boundary!=null)row["customGraphBoundary"]=boundary;}
    if(r.pointValueControls&&((int)row["state"]&32768)!=0){int parameterEnd=i+1<indices.Count?indices[i+1]:(r.headerIndex+1<hint.headers.Length?hint.headers[r.headerIndex+1]:hint.count);var controls=PointControls(root,indices[i],parameterEnd,hint.count,(int)row["top"]);if(controls!=null)row["inlinePointControls"]=controls;}
    rows.Add(row);
   }else rows.Add(new {index=indices[i],ordinal=i,role=rowRole,state=rowState});
  }
  StableViewport(r,root,h,vx,vy,vw,vh);
  Console.Write(json.Serialize(new {protocol=1,status="pass",route="windows_msaa_parameter_state",premierePid=r.pid,panelHandle=hint.handle,selectedClipTab=r.tab,headerIndex=r.headerIndex,rows,viewport=new {left=vx,top=vy,width=vw,height=vh},dispatchAccepted=dispatched,steps,rebindings,elapsedMs=timer.ElapsedMilliseconds}));return 0;
 }catch(Exception e){Console.Write(json.Serialize(new {status="unverified",route="windows_msaa_parameter_state",reason=e.Message,dispatchAccepted=dispatched,progress}));return 1;}}
}
