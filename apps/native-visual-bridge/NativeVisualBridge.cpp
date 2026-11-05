// Feature-specific Adobe Control Surface adapter. SDK headers remain external.
// The pipe worker never calls Adobe APIs. The host's Update callback owns them.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <sddl.h>
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include <stdexcept>
#include <fstream>
#include <oleacc.h>
#include <servprov.h>
#include <wrl/client.h>
#include <SPBasic.h>
#include <SPSuites.h>
#include <adobesdk/AdobesdkStringSuite.h>
#include <adobesdk/controlsurface/host/ControlSurfaceHostSuite.h>
#include <adobesdk/controlsurface/host/ControlSurfaceHostCommandSuite.h>
#include <adobesdk/controlsurface/plugin/ControlSurfacePluginSuite.h>
#include <adobesdk/controlsurface/plugin/wrapper/ControlSurfaceBase.h>
#include <adobesdk/controlsurface/plugin/wrapper/ControlSurfaceCommandBase.h>
#include "../native-read-bridge/NativeRuntimeConfiguration.h"

namespace {
SPBasicSuite* basic=nullptr;
const SPSuitesSuite* suites=nullptr;
SPSuiteListRef suiteList=nullptr;
const ADOBESDK_StringSuite1* strings=nullptr;
constexpr char pluginId[]="ai.brahma.yantra.native-visual";

std::string quote(const std::string& s){
 std::string out="\"";for(unsigned char c:s){if(c=='"'||c=='\\'){out+='\\';out+=c;}else if(c<32){char b[7];sprintf_s(b,"\\u%04x",c);out+=b;}else out+=c;}return out+'"';
}
#include "NativeEffectControls.h"
// Bounded lifecycle evidence, never command arguments, credentials or idle polling.
void lifecycle(const char* phase,const std::string& detail="") noexcept {
 try {
  static std::mutex lifecycleGate;std::lock_guard<std::mutex> lock(lifecycleGate);
  const std::wstring file=premiere_native::configuration().file(L"native-visual-instance.json.lifecycle.jsonl");
  WIN32_FILE_ATTRIBUTE_DATA attributes{};
  const bool rotate=GetFileAttributesExW(file.c_str(),GetFileExInfoStandard,&attributes)&&attributes.nFileSizeLow>65536;
  std::ofstream out(file,std::ios::binary|(rotate?std::ios::trunc:std::ios::app));
  out<<"{\"pid\":"<<GetCurrentProcessId()<<",\"threadId\":"<<GetCurrentThreadId()<<",\"tick\":"<<GetTickCount64()<<",\"phase\":"<<quote(phase)<<",\"detail\":"<<quote(detail)<<"}\n";
 }catch(...){}
}
struct SdkString {
 ADOBESDK_String value{};
 ~SdkString(){if(strings)strings->DisposeString(&value);}
 std::string utf8()const {uint32_t size=256;std::vector<ADOBESDK_UTF8Char> b(size);auto e=strings->CopyToUTF8String(&value,b.data(),&size);if(e==kADOBESDK_Error_StringBufferTooSmall&&size<=16384){b.resize(size);e=strings->CopyToUTF8String(&value,b.data(),&size);}if(e!=kSPNoError)throw std::runtime_error("SDK_STRING_READ_FAILED");return reinterpret_cast<char*>(b.data());}
 void set(const char* text){if(strings->AllocateFromUTF8(reinterpret_cast<const ADOBESDK_UTF8Char*>(text),&value)!=kSPNoError)throw std::runtime_error("SDK_STRING_ALLOC_FAILED");}
};
struct Command{std::string context,id,name,contextName;};
struct Request{
 std::string id,feature,target,response;
 ULONGLONG deadline=0;
 HANDLE ready=CreateEventW(nullptr,TRUE,FALSE,nullptr);
 ~Request(){CloseHandle(ready);}
};

// No arbitrary command ID, script, keyboard event, menu number or file argument.
const char* commandFor(const std::string& feature){
 if(feature=="selection_tool")return "cmd.tools.01pointer";
 // Exact IDs observed in the running Premiere 26.5 command registry.
 if(feature=="razor_tool")return "cmd.tools.06razor";
 if(feature=="object_selection_tool")return "cmd.tools.18smartselection";
 return nullptr;
}
bool relevant(const std::string& id){return id.find("effectcontrols")!=std::string::npos||id.find("mask")!=std::string::npos||id.find("selection")!=std::string::npos||id.find("track.")!=std::string::npos||id.find("cmd.tools.")==0||id.find("scroll")!=std::string::npos||id.find("expand")!=std::string::npos||id.find("collapse")!=std::string::npos;}

class Surface final:public adobesdk::ControlSurfaceBase,public adobesdk::ControlSurfaceCommandBase {
 const ADOBESDK_ControlSurfaceHostSuite1* host=nullptr;
 const ADOBESDK_ControlSurfaceHostCommandSuite1* commands=nullptr;
 ADOBESDK_ControlSurfaceHostCommandRef commandRef=nullptr;
 ADOBESDK_ControlSurfaceHostRef hostRef=nullptr;
 std::atomic<bool> stopping{false};
 HANDLE stopped=CreateEventW(nullptr,TRUE,FALSE,nullptr);
 std::mutex gate;
 std::shared_ptr<Request> pending;
 HANDLE worker=nullptr;
 std::vector<Command> registry;
 std::vector<std::pair<std::string,std::string>> receipts;
 std::wstring pipeName;

 void publish(bool connected){
  const std::wstring file=premiere_native::configuration().file(L"native-visual-instance.json"),temp=file+L".tmp";
  std::ofstream out(temp,std::ios::binary|std::ios::trunc);
  out<<"{\"protocol\":1,\"premierePid\":"<<GetCurrentProcessId()<<",\"connected\":"<<(connected?"true":"false")<<",\"version\":\"0.1.0\"}";out.close();
  if(!out||!MoveFileExW(temp.c_str(),file.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw std::runtime_error("INSTANCE_RECEIPT_WRITE_FAILED");
 }

 std::string envelope(const std::string& id,const std::string& body){return "{\"protocol\":1,\"id\":"+quote(id)+",\"premierePid\":"+std::to_string(GetCurrentProcessId())+",\"version\":\"0.1.0\","+body+"}\n";}
 void refreshRegistry(){
  uint32_t n=0;if(commands->GetCommandCount(commandRef,&n)!=kSPNoError||n>10000)throw std::runtime_error("COMMAND_REGISTRY_UNAVAILABLE");
  std::vector<Command> next;for(uint32_t i=0;i<n;i++){SdkString ctx,ctxName,id,name;if(commands->GetCommand(commandRef,i,&ctx.value,&ctxName.value,&id.value,&name.value)!=kSPNoError)throw std::runtime_error("COMMAND_REGISTRY_INCOMPLETE");next.push_back({ctx.utf8(),id.utf8(),name.utf8(),ctxName.utf8()});}registry=std::move(next);lifecycle("registry_read",std::to_string(registry.size()));
 }
 std::string dispatch(const Request& r){
  // Connect can precede the host's command-handler creation. Rebind on a host
  // Update request after it has received our registered command interface.
  if(!commandRef){const auto e=host->GetCommandRef(hostRef,&commandRef);if(e!=kSPNoError||!commandRef)throw std::runtime_error("COMMAND_REF_UNAVAILABLE:"+std::to_string(e));}
  if(registry.empty())refreshRegistry();
  if(effectFeature(r.feature)){
   auto before=inspectEffectPanel(r.target);std::string stateBefore=effectPanelJson(before);SPErr result=kSPNoError;
   if(r.feature=="inspect_effect_controls")return envelope(r.id,"\"status\":\"pass\",\"route\":\"in_process_msaa\",\"observation\":"+stateBefore);
   if(r.feature=="effect_expand_first"||r.feature=="effect_collapse_first"){
    const bool desired=r.feature=="effect_expand_first";if(((before.headers[0].state&STATE_SYSTEM_PRESSED)!=0)!=desired)result=before.headers[0].object->accDoDefaultAction(selfChild());
   }else{
    DWORD thread=GetWindowThreadProcessId(before.window,nullptr);GUITHREADINFO info{sizeof(GUITHREADINFO)};
    if(!GetGUIThreadInfo(thread,&info)||info.hwndFocus!=before.window)throw std::runtime_error("EFFECT_PANEL_FOCUS_REQUIRED");
    if(r.feature=="effect_video_group_toggle"){
     const Command* found=nullptr;for(const auto& c:registry)if(c.context=="effectcontrols"&&c.id=="cmd.effectcontrols.videoexpander"){if(found)throw std::runtime_error("EFFECT_COMMAND_AMBIGUOUS");found=&c;}
     if(!found)throw std::runtime_error("EFFECT_COMMAND_NOT_REGISTERED");SdkString context,command;context.set(found->context.c_str());command.set(found->id.c_str());result=commands->ExecuteCommand(commandRef,&context.value,&command.value);
    }else{
     int delta=r.feature=="effect_scroll_down"?1:-1;
     result=commands->Navigate(commandRef,kAdobesdk_True,0,delta,kAdobesdk_False);
     auto release=commands->Navigate(commandRef,kAdobesdk_False,0,delta,kAdobesdk_False);if(result==kSPNoError)result=release;
    }
   }
   return envelope(r.id,"\"status\":\"unverified\",\"route\":\"in_process_native_effect_controls\",\"feature\":"+quote(r.feature)+",\"dispatchAccepted\":"+(result==0?"true":"false")+",\"sdkError\":"+std::to_string(result)+",\"before\":"+stateBefore+",\"after\":"+effectPanelJson(inspectEffectPanel(r.target)));
  }
  if(r.feature=="inspect"){
   std::string list="[";bool first=true;for(const auto& c:registry){if(!relevant(c.id))continue;if(!first)list+=',';first=false;list+="{\"context\":"+quote(c.context)+",\"id\":"+quote(c.id)+",\"name\":"+quote(c.name)+",\"contextName\":"+quote(c.contextName)+"}";}list+=']';
   return envelope(r.id,"\"status\":\"pass\",\"route\":\"adobe_control_surface_sdk\",\"commandCount\":"+std::to_string(registry.size())+",\"commands\":"+list+",\"stateReadback\":\"not_exposed_by_command_suite\"");
  }
  const char* id=commandFor(r.feature);if(!id)throw std::runtime_error("FEATURE_NOT_ALLOWLISTED");
  // Global tool commands must exist uniquely in the host's current registry.
  std::vector<Command> matches;for(const auto& c:registry)if(c.id==id)matches.push_back(c);
  if(matches.size()!=1)throw std::runtime_error("COMMAND_NOT_UNIQUE_IN_LIVE_REGISTRY");
  SdkString command,context;command.set(id);const auto& c=matches.front();if(!c.context.empty())context.set(c.context.c_str());
  auto result=commands->ExecuteCommand(commandRef,c.context.empty()?nullptr:&context.value,&command.value);
  return envelope(r.id,"\"status\":\"unverified\",\"route\":\"adobe_control_surface_sdk\",\"feature\":"+quote(r.feature)+",\"commandId\":"+quote(id)+",\"context\":"+quote(c.context)+",\"dispatchAccepted\":"+(result==kSPNoError?"true":"false")+",\"sdkError\":"+std::to_string(result)+",\"reason\":\"Command execution is not native tool-state proof; verify visible toolbar separately\"");
 }
 static DWORD WINAPI runWorker(void* raw){static_cast<Surface*>(raw)->serve();return 0;}
 bool awaitIo(HANDLE pipe,OVERLAPPED& io,BOOL immediate,DWORD error,DWORD& count){
  if(immediate)return true;
  if(error!=ERROR_IO_PENDING)return false;
  HANDLE events[]={stopped,io.hEvent};
  if(WaitForMultipleObjects(2,events,FALSE,4000)!=WAIT_OBJECT_0+1){CancelIoEx(pipe,&io);GetOverlappedResult(pipe,&io,&count,TRUE);return false;}
  return GetOverlappedResult(pipe,&io,&count,FALSE)!=FALSE;
 }
 void serve(){
  // Current-user owner rights only; remote pipe clients are explicitly rejected.
  PSECURITY_DESCRIPTOR descriptor=nullptr;
  if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:P(A;;GA;;;OW)",SDDL_REVISION_1,&descriptor,nullptr))return;
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES),descriptor,FALSE};
  while(!stopping){
   HANDLE pipe=CreateNamedPipeW(pipeName.c_str(),PIPE_ACCESS_DUPLEX|FILE_FLAG_FIRST_PIPE_INSTANCE|FILE_FLAG_OVERLAPPED,PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,1,131072,4096,1000,&security);
   if(pipe==INVALID_HANDLE_VALUE){lifecycle("pipe_create_failed",std::to_string(GetLastError()));break;}
   OVERLAPPED io{};io.hEvent=CreateEventW(nullptr,TRUE,FALSE,nullptr);DWORD transferred=0;
   BOOL accepted=ConnectNamedPipe(pipe,&io);DWORD connectError=GetLastError();
   // Idle connection waiting has no polling or file scanning.
   bool connected=accepted||connectError==ERROR_PIPE_CONNECTED;
   if(!connected&&connectError==ERROR_IO_PENDING){HANDLE events[]={stopped,io.hEvent};if(WaitForMultipleObjects(2,events,FALSE,INFINITE)==WAIT_OBJECT_0+1)connected=GetOverlappedResult(pipe,&io,&transferred,FALSE)!=FALSE;else{CancelIoEx(pipe,&io);GetOverlappedResult(pipe,&io,&transferred,TRUE);}}
   if(connected&&!stopping){
    char buffer[4096];DWORD n=0;
    ResetEvent(io.hEvent);BOOL read=ReadFile(pipe,buffer,sizeof(buffer),&n,&io);DWORD readError=GetLastError();
    if(awaitIo(pipe,io,read,readError,n)&&n>0&&n<sizeof(buffer)){
     std::string input(buffer,n);auto a=input.find('\t'),b=input.find('\t',a==std::string::npos?0:a+1);
     std::string id=b==std::string::npos?"":input.substr(a+1,b-a-1),feature=b==std::string::npos?"":input.substr(b+1);
     if(!feature.empty()&&feature.back()=='\n')feature.pop_back();
     std::string target;auto parameter=feature.find('\t');if(parameter!=std::string::npos){target=feature.substr(parameter+1);feature=feature.substr(0,parameter);}
     std::string response;
     if(a==std::string::npos||b==std::string::npos||input.substr(0,a)!=premiere_native::configuration().token||id.size()!=36||id.find_first_not_of("0123456789abcdef-")!=std::string::npos||(feature!="inspect"&&!commandFor(feature)&&!effectFeature(feature))||(!effectFeature(feature)&&!target.empty()))response=envelope(id,"\"status\":\"fail\",\"reason\":\"INVALID_AUTHENTICATED_FEATURE_REQUEST\"");
     else {
      for(const auto& old:receipts)if(old.first==id)response=old.second;
      if(response.empty()){
       auto r=std::make_shared<Request>();r->id=id;r->feature=feature;r->target=target;r->deadline=GetTickCount64()+3000;
       {std::lock_guard<std::mutex> lock(gate);pending=r;}
       HANDLE events[]={stopped,r->ready};DWORD wait=WaitForMultipleObjects(2,events,FALSE,4000);
       {std::lock_guard<std::mutex> lock(gate);if(pending==r)pending.reset();response=wait==WAIT_OBJECT_0+1?r->response:envelope(id,"\"status\":\"unverified\",\"reason\":\"HOST_UPDATE_TIMEOUT_INSPECT_BEFORE_RETRY\"");}
       receipts.push_back({id,response});if(receipts.size()>64)receipts.erase(receipts.begin());
      }
     }
     DWORD written=0;ResetEvent(io.hEvent);BOOL sent=WriteFile(pipe,response.data(),static_cast<DWORD>(response.size()),&written,&io);DWORD sendError=GetLastError();
     if(awaitIo(pipe,io,sent,sendError,written)&&written==response.size()){
      // DisconnectNamedPipe discards unread response bytes. Keep the pipe alive
      // until the client consumes the receipt and closes (or a bounded timeout).
      // Unlike FlushFileBuffers, this overlapped wait is cancellable on shutdown.
      char receiptConsumed=0;DWORD ackBytes=0;ResetEvent(io.hEvent);
      BOOL ack=ReadFile(pipe,&receiptConsumed,1,&ackBytes,&io);DWORD ackError=GetLastError();
      awaitIo(pipe,io,ack,ackError,ackBytes);
     }else lifecycle("response_write_failed",std::to_string(sendError));
    }
   }
   DisconnectNamedPipe(pipe);CloseHandle(io.hEvent);CloseHandle(pipe);
  }
  LocalFree(descriptor);
 }
public:
 void connect(ADOBESDK_ControlSurfaceHostRef ref){
  (void)premiere_native::configuration();
  lifecycle("connect_entered");
  if(basic->AcquireSuite(kADOBESDK_ControlSurfaceHostSuite,1,reinterpret_cast<const void**>(&host))!=kSPNoError)throw std::runtime_error("HOST_SUITE_UNAVAILABLE");
  if(basic->AcquireSuite(kADOBESDK_ControlSurfaceHostCommandSuite,1,reinterpret_cast<const void**>(&commands))!=kSPNoError)throw std::runtime_error("COMMAND_SUITE_UNAVAILABLE");
  hostRef=ref;
  pipeName=L"\\\\.\\pipe\\Brahma.Yantra.NativeVisual.v1."+std::to_wstring(GetCurrentProcessId());
  worker=CreateThread(nullptr,0,runWorker,this,0,nullptr);if(!worker)throw std::runtime_error("PIPE_WORKER_UNAVAILABLE");
  publish(true);
  lifecycle("connected");
 }
 ~Surface(){
  stopping=true;SetEvent(stopped);{std::lock_guard<std::mutex> lock(gate);if(pending){pending->response=envelope(pending->id,"\"status\":\"unverified\",\"reason\":\"PLUGIN_DISCONNECTED\"");SetEvent(pending->ready);pending.reset();}}
  if(worker){WaitForSingleObject(worker,INFINITE);CloseHandle(worker);}CloseHandle(stopped);
  if(worker){try{publish(false);}catch(...){}}
  if(commands)basic->ReleaseSuite(kADOBESDK_ControlSurfaceHostCommandSuite,1);
  if(host)basic->ReleaseSuite(kADOBESDK_ControlSurfaceHostSuite,1);
 }
 SPErr GetConfigIdentifier(ADOBESDK_String* out)const override{return strings->AllocateFromUTF8(reinterpret_cast<const ADOBESDK_UTF8Char*>(pluginId),out);}
 SPErr GetCommandRef(ADOBESDK_ControlSurfaceCommandRef* out)override{*out=reinterpret_cast<ADOBESDK_ControlSurfaceCommandRef>(static_cast<adobesdk::ControlSurfaceCommandBase*>(this));return kSPNoError;}
 // No configurable hardware buttons and no caller-provided command assignments.
 SPErr GetUserButtonCount(uint32_t* out)const override{*out=0;return kSPNoError;}
 SPErr Update()override{
  std::lock_guard<std::mutex> lock(gate);if(!pending)return kSPNoError;
  auto r=pending;pending.reset();
  try{
   // SDK Connect and Update need not share a thread. This private dispatch is
   // owned by the host Update callback and serialized by gate, never the pipe.
   if(GetTickCount64()>r->deadline)throw std::runtime_error("REQUEST_EXPIRED_BEFORE_DISPATCH");
   r->response=dispatch(*r);
  }catch(const std::exception& e){lifecycle("dispatch_failed",e.what());r->response=envelope(r->id,"\"status\":\"fail\",\"reason\":"+quote(e.what()));}
  SetEvent(r->ready);return kSPNoError;
 }
};
struct Instance{Surface* surface=nullptr;~Instance(){delete surface;}};
SPErr connect(ADOBESDK_ControlSurfacePluginRef p,ADOBESDK_ControlSurfaceHostRef h,ADOBESDK_ControlSurfaceRef* out){try{auto instance=reinterpret_cast<Instance*>(p);if(instance->surface)return kSPBadParameterError;auto s=std::make_unique<Surface>();s->connect(h);*out=reinterpret_cast<ADOBESDK_ControlSurfaceRef>(static_cast<adobesdk::ControlSurfaceBase*>(s.get()));instance->surface=s.release();return kSPNoError;}catch(const std::exception& e){lifecycle("connect_failed",e.what());*out=nullptr;return kSPBadParameterError;}catch(...){lifecycle("connect_failed","UNKNOWN_EXCEPTION");*out=nullptr;return kSPBadParameterError;}}
SPErr disconnect(ADOBESDK_ControlSurfacePluginRef p){lifecycle("disconnect");auto i=reinterpret_cast<Instance*>(p);delete i->surface;i->surface=nullptr;return kSPNoError;}
SPErr getId(ADOBESDK_ControlSurfacePluginRef,ADOBESDK_String* out){return strings->AllocateFromUTF8(reinterpret_cast<const ADOBESDK_UTF8Char*>(pluginId),out);}
SPErr getName(ADOBESDK_ControlSurfacePluginRef,ADOBESDK_String* out){return strings->AllocateFromUTF8(reinterpret_cast<const ADOBESDK_UTF8Char*>("Premiere MCP Native Visual"),out);}
SPErr getSettings(ADOBESDK_ControlSurfacePluginRef,ADOBESDK_String* out){lifecycle("get_settings");return strings->AllocateFromUTF8(reinterpret_cast<const ADOBESDK_UTF8Char*>("{}"),out);}
SPErr setSettings(ADOBESDK_ControlSurfacePluginRef,const ADOBESDK_String*){lifecycle("set_settings");return kSPNoError;}
SPErr hasDialog(ADOBESDK_ControlSurfacePluginRef,ADOBESDK_Boolean* out){*out=kAdobesdk_False;return kSPNoError;}
SPErr dialog(ADOBESDK_ControlSurfacePluginRef,void*,ADOBESDK_Boolean*){return kSPUnimplementedError;}
SPErr focusChanged(ADOBESDK_ControlSurfacePluginRef){return kSPNoError;}
ADOBESDK_ControlSurfacePluginSuite1 pluginSuite={connect,disconnect,getId,getName,getSettings,setSettings,hasDialog,dialog,focusChanged,focusChanged};
SPErr startup(){
 lifecycle("startup");
 auto e=basic->AcquireSuite(kADOBESDK_StringSuite,1,reinterpret_cast<const void**>(&strings));if(e!=kSPNoError)return e;
 e=basic->AcquireSuite(kSPSuitesSuite,kSPSuitesSuiteVersion,reinterpret_cast<const void**>(&suites));if(e!=kSPNoError)return e;
 e=suites->AllocateSuiteList(kSPRuntimeStringPool,kSPRuntimePluginList,&suiteList);if(e!=kSPNoError)return e;
 SPSuiteRef added=nullptr;e=suites->AddSuite(suiteList,nullptr,kADOBESDK_ControlSurfacePluginSuite,1,1,&pluginSuite,&added);if(e!=kSPNoError)return e;
 adobesdk::ControlSurfaceBase::RegisterSuite(const_cast<SPSuitesSuite*>(suites),suiteList);
 adobesdk::ControlSurfaceCommandBase::RegisterSuite(const_cast<SPSuitesSuite*>(suites),suiteList);return kSPNoError;
}
SPErr shutdown(){if(suiteList)suites->FreeSuiteList(suiteList);suiteList=nullptr;if(suites)basic->ReleaseSuite(kSPSuitesSuite,kSPSuitesSuiteVersion);suites=nullptr;if(strings)basic->ReleaseSuite(kADOBESDK_StringSuite,1);strings=nullptr;return kSPNoError;}
SPErr create(ADOBESDK_ControlSurfacePluginRef* out){lifecycle("create_instance");*out=reinterpret_cast<ADOBESDK_ControlSurfacePluginRef>(new Instance());return kSPNoError;}
SPErr destroy(ADOBESDK_ControlSurfacePluginRef p){delete reinterpret_cast<Instance*>(p);return kSPNoError;}
SPErr getSuites(SPSuiteListRef* out){*out=suiteList;return kSPNoError;}
}
extern "C" ADOBE_CONTROLSURFACE_API SPErr EntryPoint(SPBasicSuite* inBasic,uint32_t,uint32_t,ADOBESDK_ControlSurfaceHostID host,ADOBESDK_ControlSurfacePluginFuncs* out){
 if(!inBasic||!out||host!=kADOBESDK_ControlSurfaceHost_PremierePro)return kSPBadParameterError;
 basic=inBasic;*out={startup,shutdown,create,destroy,getSuites};return kSPNoError;
}
