using System;using System.Collections.Generic;using System.Diagnostics;using System.Runtime.InteropServices;using System.Text;using System.Web.Script.Serialization;using Accessibility;

// Existing selected caption, font-style combo only. No synthetic input, script,
// menu dispatch, save, arbitrary child index or caller-supplied native handle.
internal static class PremiereCaptionStyleBridge {
 internal sealed class Request {public int protocol{get;set;}public int pid{get;set;}public string operation{get;set;}public string sequenceName{get;set;}public int trackIndex{get;set;}public string trackName{get;set;}public int itemIndex{get;set;}public int itemCount{get;set;}public string expectedFontFamily{get;set;}public string expectedFontStyle{get;set;}public string fontStyle{get;set;}}
 delegate bool Callback(IntPtr h,IntPtr state);
 [DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr h,Callback callback,IntPtr state);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("oleacc.dll")]static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 static IAccessible Root(IntPtr h,int pid){uint owner;GetWindowThreadProcessId(h,out owner);if(owner!=pid||!IsWindowVisible(h))throw new Exception("CAPTION_PANEL_CHANGED");var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object raw;if(AccessibleObjectFromWindow(h,0xfffffffc,ref iid,out raw)!=0)throw new Exception("CAPTION_PANEL_UNAVAILABLE");return raw as IAccessible;}
 static IAccessible Child(IAccessible root,int i){var c=root.get_accChild(i) as IAccessible;if(c==null)throw new Exception("CAPTION_CONTROL_UNAVAILABLE");return c;}
 static void Visible(IAccessible c,int role){int state=Convert.ToInt32(c.get_accState(0));if(Convert.ToInt32(c.get_accRole(0))!=role||(state&(1|32768|65536))!=0)throw new Exception("CAPTION_CONTROL_NOT_AVAILABLE");}
 static void Guard(IAccessible root,Request r){if(root==null||root.get_accName(0)!="Properties2"||root.accChildCount<40||root.accChildCount>2200)throw new Exception("CAPTION_LAYOUT_UNVERIFIED");var header=Child(root,3);var count=Child(root,4);Visible(header,41);Visible(count,41);if(header.get_accName(0).TrimEnd()!="C"+(r.trackIndex+1)+":"+r.trackName||count.get_accName(0)!=(r.itemIndex+1)+" / "+r.itemCount)throw new Exception("CAPTION_SELECTION_CHANGED");var family=Child(root,28);var style=Child(root,29);Visible(family,46);Visible(style,46);if(family.get_accName(0)!="글꼴"||style.get_accName(0)!="글꼴 스타일")throw new Exception("CAPTION_FONT_LAYOUT_UNVERIFIED");}
 static object Observe(IAccessible root){var family=Child(root,28);var style=Child(root,29);int count=style.accChildCount;if(count<1||count>128)throw new Exception("CAPTION_STYLE_OPTIONS_UNBOUNDED");var choices=new List<string>();for(int i=1;i<=count;i++)choices.Add(style.get_accName(i));return new{fontFamily=family.get_accValue(0),fontStyle=style.get_accValue(0),fontStyleChoices=choices};}
 static void GuardSequence(IntPtr timelineFrame,IntPtr programFrame,Request r){
  var timeline=Root(timelineFrame,r.pid);var program=Root(programFrame,r.pid);
  if(timeline==null||program==null||timeline.get_accName(0)!="WorkspaceFrame"||program.get_accName(0)!="WorkspaceFrame")throw new Exception("CAPTION_NATIVE_SEQUENCE_CHANGED");
  var t=Child(timeline,2);var p=Child(program,2);
  // Hidden tab selector controls still report the selected native workspace tab.
  // They are observations only; no selection, focus or visibility action is sent.
  if(Convert.ToInt32(t.get_accRole(0))!=46||Convert.ToInt32(p.get_accRole(0))!=46||t.get_accValue(0)!=r.sequenceName||p.get_accValue(0)!="프로그램: "+r.sequenceName)throw new Exception("CAPTION_NATIVE_SEQUENCE_CHANGED");
 }
 [STAThread]public static int Main(string[]args){Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();bool dispatched=false;try{
  if(args.Length!=1)throw new Exception("CAPTION_REQUEST_REQUIRED");var r=json.Deserialize<Request>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
  if(r.protocol!=1||r.pid<=0||(r.operation!="read"&&r.operation!="set_font_style")||String.IsNullOrEmpty(r.sequenceName)||r.sequenceName.Length>500||r.trackIndex<0||r.trackIndex>99||String.IsNullOrEmpty(r.trackName)||r.trackName.Length>500||r.itemIndex<0||r.itemIndex>=r.itemCount||r.itemCount>10000)throw new Exception("CAPTION_REQUEST_INVALID");
  var p=Process.GetProcessById(r.pid);if(p.ProcessName!="Adobe Premiere Pro")throw new Exception("CAPTION_PROCESS_CHANGED");var version=FileVersionInfo.GetVersionInfo(p.MainModule.FileName);if(version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("CAPTION_VERSION_UNVERIFIED");
  IntPtr handle=IntPtr.Zero,timelineFrame=IntPtr.Zero,programFrame=IntPtr.Zero;int matches=0,timelines=0,programs=0,visited=0;var timer=Stopwatch.StartNew();Exception scanError=null;
  EnumChildWindows(p.MainWindowHandle,(h,s)=>{if(++visited>200||timer.ElapsedMilliseconds>3000){scanError=new Exception("CAPTION_PANEL_SCAN_LIMIT");return false;}if(!IsWindowVisible(h))return true;try{var root=Root(h,r.pid);if(root==null)return true;string name=root.get_accName(0);if(name=="Properties2"){handle=h;matches++;}if(name=="WorkspaceFrame"&&root.accChildCount>=2){var tab=Child(root,2);if(Convert.ToInt32(tab.get_accRole(0))==46){string value=tab.get_accValue(0);if(value==r.sequenceName){timelineFrame=h;timelines++;}if(value=="프로그램: "+r.sequenceName){programFrame=h;programs++;}}}}catch{}return true;},IntPtr.Zero);
  if(scanError!=null)throw scanError;if(matches!=1)throw new Exception("CAPTION_PANEL_NOT_UNIQUE");if(timelines!=1||programs!=1)throw new Exception("CAPTION_NATIVE_SEQUENCE_UNVERIFIED");GuardSequence(timelineFrame,programFrame,r);var panel=Root(handle,r.pid);Guard(panel,r);var before=Observe(panel);
  if(r.operation=="set_font_style"){
   if(String.IsNullOrEmpty(r.expectedFontFamily)||String.IsNullOrEmpty(r.expectedFontStyle)||String.IsNullOrEmpty(r.fontStyle)||r.fontStyle.Length>200)throw new Exception("CAPTION_FONT_GUARD_REQUIRED");var family=Child(panel,28);var style=Child(panel,29);
   if(family.get_accValue(0)!=r.expectedFontFamily||style.get_accValue(0)!=r.expectedFontStyle)throw new Exception("CAPTION_FONT_CHANGED");int option=0;for(int i=1;i<=style.accChildCount;i++)if(style.get_accName(i)==r.fontStyle){if(option!=0)throw new Exception("CAPTION_FONT_STYLE_AMBIGUOUS");option=i;}
   if(option==0)throw new Exception("CAPTION_FONT_STYLE_UNAVAILABLE");
   if(r.fontStyle!=r.expectedFontStyle){Guard(Root(handle,r.pid),r);GuardSequence(timelineFrame,programFrame,r);dispatched=true;style.accSelect(2,option);}
   panel=Root(handle,r.pid);Guard(panel,r);GuardSequence(timelineFrame,programFrame,r);if(Child(panel,28).get_accValue(0)!=r.expectedFontFamily||Child(panel,29).get_accValue(0)!=r.fontStyle)throw new Exception("CAPTION_FONT_READBACK_MISMATCH");
  }
  Console.Write(json.Serialize(new{protocol=1,status="pass",route="windows_msaa_caption_font_style",premierePid=r.pid,sequenceName=r.sequenceName,contentDispatched=dispatched,trackIndex=r.trackIndex,trackName=r.trackName,itemIndex=r.itemIndex,itemCount=r.itemCount,before,after=Observe(panel)}));return 0;
 }catch(Exception e){Console.Write(json.Serialize(new{protocol=1,status=dispatched?"unverified":"fail",route="windows_msaa_caption_font_style",contentDispatched=dispatched,reason=e.Message}));return 1;}}
}
