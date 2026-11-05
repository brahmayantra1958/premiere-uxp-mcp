using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

// Exactly one semantic menu action. No caller command ID, mouse or keyboard input.
internal static class NativeReadTrigger {
 [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu,int index);
 [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
 [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu,int index);
 [DllImport("user32.dll")] static extern uint GetMenuState(IntPtr menu,uint index,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetMenuString(IntPtr menu,uint index,StringBuilder text,int length,uint flags);
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,out IntPtr result);
 static int visited;
 static readonly List<uint> matches=new List<uint>();
 static string Label(IntPtr menu,int index){var text=new StringBuilder(512);GetMenuString(menu,(uint)index,text,text.Capacity,0x400);return text.ToString().Split('\t')[0].Replace("(&F)","").Replace("(&E)","").Replace("&","").Trim();}
 static int PopupIndex(IntPtr parent,string en,string ko){
  int found=-1,count=GetMenuItemCount(parent);if(count<0||count>512)throw new Exception("READ_MENU_COUNT_"+en.ToUpperInvariant());
  for(int i=0;i<count;i++)if(Label(parent,i)==en||Label(parent,i)==ko){if(found!=-1)throw new Exception("READ_MENU_ANCESTOR_AMBIGUOUS");found=i;}
  if(found<0)throw new Exception("READ_MENU_ANCESTOR_ABSENT");return found;
 }
 static IntPtr Popup(IntPtr parent,string en,string ko){var popup=GetSubMenu(parent,PopupIndex(parent,en,ko));if(popup==IntPtr.Zero)throw new Exception("READ_MENU_ANCESTOR_ABSENT");return popup;}
 static void InitializePopup(IntPtr window,IntPtr parent,string en,string ko){
  int found=PopupIndex(parent,en,ko);var popup=GetSubMenu(parent,found);if(popup==IntPtr.Zero)throw new Exception("READ_MENU_ANCESTOR_ABSENT");
  // Ask Premiere to refresh this fixed native popup's command routing. This
  // does not open it or synthesize a pointer/keyboard/menu selection event.
  IntPtr result;if(SendMessageTimeout(window,0x117,popup,new IntPtr(found),2,1000,out result)==IntPtr.Zero)throw new Exception("READ_MENU_INITIALIZATION_UNVERIFIED");
 }
 static void Find(IntPtr menu){
  int count=GetMenuItemCount(menu);if(count<0||count>512)throw new Exception("READ_MENU_COUNT_COMMAND");
  for(int i=0;i<count;i++){
   if(++visited>2000)throw new Exception("READ_MENU_BUDGET");
   var text=new StringBuilder(512);GetMenuString(menu,(uint)i,text,text.Capacity,0x400);
   string label=text.ToString().Split('\t')[0].Replace("&","").Trim();
   // Premiere appends this literal ellipsis to Export Controller labels.
   if(label=="Premiere MCP Native Read..."||label=="Premiere MCP Native Read"){
    uint id=GetMenuItemID(menu,i),state=GetMenuState(menu,(uint)i,0x400);
    if(id==0||id==UInt32.MaxValue||state==UInt32.MaxValue||(state&3)!=0||GetSubMenu(menu,i)!=IntPtr.Zero)throw new Exception("READ_MENU_UNAVAILABLE");
    matches.Add(id);
   }
   // Our Export Controller is a direct child of the fixed Export popup.
   // Unrelated lazy submenus are not part of this command's identity proof.
  }
 }
 public static int Main(string[] args){
  // A runtime-owned worker can invoke this same fixed operation repeatedly.
  // Command identity is rediscovered on every call; no menu ID/state is cached.
  visited=0;matches.Clear();
  var json=new JavaScriptSerializer();bool dispatched=false;
  try{
   if(args.Length!=0)throw new Exception("READ_TRIGGER_HAS_NO_ARGUMENTS");
   var processes=Process.GetProcessesByName("Adobe Premiere Pro");if(processes.Length!=1)throw new Exception("READ_PROCESS_AMBIGUOUS");
   using(var process=processes[0]){
    var version=FileVersionInfo.GetVersionInfo(process.MainModule.FileName);
    if(version.FileMajorPart!=26||version.FileMinorPart!=5)throw new Exception("READ_HOST_VERSION_UNVERIFIED");
    var window=process.MainWindowHandle;uint owner;
    if(window==IntPtr.Zero||!IsWindowEnabled(window)||!IsWindowVisible(window)||GetWindowThreadProcessId(window,out owner)==0||owner!=process.Id)throw new Exception("READ_HOST_WINDOW_UNAVAILABLE");
    InitializePopup(window,GetMenu(window),"File","파일");
    var file=Popup(GetMenu(window),"File","파일");InitializePopup(window,file,"Export","내보내기");
    // Popup initialization can replace handles. Reacquire the entire fixed
    // path after both callbacks; stale handles cannot prove command identity.
    file=Popup(GetMenu(window),"File","파일");var export=Popup(file,"Export","내보내기");
    Find(export);if(matches.Count!=1)throw new Exception("READ_MENU_NOT_UNIQUE_OR_NOT_INSTALLED");
    IntPtr result;dispatched=true;
    if(SendMessageTimeout(window,0x111,new IntPtr(matches[0]),IntPtr.Zero,2,10000,out result)==IntPtr.Zero)throw new Exception("READ_DISPATCH_UNVERIFIED");
    Console.Write(json.Serialize(new {status="partial",premierePid=process.Id,dispatchAccepted=true,route="fixed_native_read_menu",requires="correlated_sdk_result"}));return 0;
   }
  }catch(Exception e){Console.Write(json.Serialize(new {status="unverified",dispatchAttempted=dispatched,code=e.Message}));return 1;}
 }
}
