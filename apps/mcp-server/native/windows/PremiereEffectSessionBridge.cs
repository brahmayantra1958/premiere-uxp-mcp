using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

// Same three fixed adapters, one runtime-owned process. Blocks on stdin when
// idle and exits on EOF; no desktop polling, pointer/key/click or script route.
internal static class PremiereEffectSessionBridge {
 sealed class Request {public int id {get;set;}public string operation {get;set;}public string[] args {get;set;}}
 public static int Main(){
  Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();
  PremiereEffectStateBridge.WorkerMode=true;PremiereEffectScrollBridge.WorkerMode=true;
  PremiereParameterStateBridge.WorkerMode=true;
  string line;while((line=Console.ReadLine())!=null){
   int id=0;object result;var realOutput=Console.Out;
   try{
    if(line.Length>32768)throw new Exception("REQUEST_TOO_LARGE");
    var request=json.Deserialize<Request>(line);id=request.id;
    if(id<=0||request.args==null||request.args.Length>3)throw new Exception("INVALID_FIXED_REQUEST");
    using(var captured=new StringWriter()){
     Console.SetOut(captured);
     try{
      switch(request.operation){
       case "state":PremiereEffectStateBridge.Main(request.args);break;
       case "panel":PremierePanelBridge.Main(request.args);break;
       case "scroll":PremiereEffectScrollBridge.Main(request.args);break;
       case "parameter":PremiereParameterStateBridge.Main(request.args);break;
       case "read_trigger":NativeReadTrigger.Main(request.args);break;
       default:throw new Exception("OPERATION_NOT_ALLOWLISTED");
      }
     }finally{Console.SetOut(realOutput);}
     result=json.DeserializeObject(captured.ToString());
    }
   }catch(Exception error){Console.SetOut(realOutput);result=new {status="unverified",reason=error.Message};}
   Console.WriteLine(json.Serialize(new {id,result}));Console.Out.Flush();
  }
  return 0;
 }
}
