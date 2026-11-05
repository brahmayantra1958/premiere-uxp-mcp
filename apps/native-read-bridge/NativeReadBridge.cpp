// Read-only Adobe SDK adapter. All Adobe objects stay inside the host callback.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <PrSDKExportController.h>
#include <PrSDKVideoSegmentSuite.h>
#include <PrSDKMemoryManagerSuite.h>
#include <PrSDKApplicationSettingsSuite.h>
#include <PrSDKExportControllerSuite.h>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <set>
#include <vector>
#include "NativeReadRequest.h"
#include "NativeClipClock.h"
#include "NativeRuntimeConfiguration.h"

namespace {
std::mutex gate;
premiere_read::ReplayWindow seen;
std::int64_t now(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
std::string quote(const std::string& s){std::string out="\"";for(unsigned char c:s){if(c=='"'||c=='\\'){out+='\\';out+=c;}else if(c<32){char b[7];sprintf_s(b,"\\u%04x",c);out+=b;}else out+=c;}return out+'"';}
void lifecycle(const char* phase,long code=0)noexcept {
 try{const std::wstring file=premiere_native::configuration().file(L"native-read-result.json.lifecycle.jsonl");WIN32_FILE_ATTRIBUTE_DATA attributes{};
  const bool rotate=GetFileAttributesExW(file.c_str(),GetFileExInfoStandard,&attributes)&&(attributes.nFileSizeHigh||attributes.nFileSizeLow>65536);
  std::ofstream out(file,std::ios::binary|(rotate?std::ios::trunc:std::ios::app));out<<"{\"pid\":"<<GetCurrentProcessId()<<",\"phase\":"<<quote(phase)<<",\"code\":"<<code<<",\"at\":"<<now()<<"}\n";
 }catch(...){}
}
void checked(prSuiteError error,const char* code){if(error!=0)throw std::runtime_error(code);}
template<class T>struct Suite {
 SPBasicSuite* basic;const char* name;int version;const T* value=nullptr;
 Suite(SPBasicSuite* b,const char* n,int v):basic(b),name(n),version(v){if(basic->AcquireSuite(name,version,reinterpret_cast<const void**>(&value))!=kSPNoError||!value)throw std::runtime_error("READ_SUITE_UNAVAILABLE");}
 ~Suite(){basic->ReleaseSuite(name,version);}
 Suite(const Suite&)=delete;Suite& operator=(const Suite&)=delete;
};
struct Node {
 const PrSDKVideoSegmentSuite* sdk;csSDK_int32 id;
 ~Node(){sdk->ReleaseVideoNodeID(id);}
 Node(const PrSDKVideoSegmentSuite* s,csSDK_int32 i):sdk(s),id(i){}
 Node(const Node&)=delete;Node& operator=(const Node&)=delete;
};
struct Segments {
 const PrSDKVideoSegmentSuite* sdk;csSDK_int32 id=0;
 Segments(const PrSDKVideoSegmentSuite* s,PrTimelineID timeline):sdk(s){checked(sdk->AcquireVideoSegmentsID(timeline,&id),"READ_SEGMENTS_UNAVAILABLE");}
 ~Segments(){sdk->ReleaseVideoSegmentsID(id);}
 Segments(const Segments&)=delete;Segments& operator=(const Segments&)=delete;
};
struct Property {
 const PrSDKMemoryManagerSuite* memory;PrMemoryPtr value=nullptr;
 ~Property(){if(value)memory->PrDisposePtr(value);}
};
struct SdkString {
 const PrSDKStringSuite* suite;PrSDKString value{};bool allocated=false;
 // A failed output API does not transfer ownership. Premiere 26.5 reports
 // StringNotFound for DisposeString on that zero-initialized output, despite
 // the SDK's general empty-string wording. Dispose only successful outputs.
 ~SdkString(){if(allocated)suite->DisposeString(&value);}
 SdkString(const PrSDKStringSuite* s):suite(s){}
 SdkString(const SdkString&)=delete;SdkString& operator=(const SdkString&)=delete;
 std::string utf8(){char buffer[4096]{};csSDK_uint32 count=sizeof(buffer);checked(suite->CopyToUTF8String(&value,reinterpret_cast<prUTF8Char*>(buffer),&count),"READ_IDENTITY_STRING_FAILED");if(!count||count>sizeof(buffer)||buffer[count-1]!=0)throw std::runtime_error("READ_IDENTITY_STRING_UNBOUNDED");return buffer;}
};
std::string numeric(double n){if(!std::isfinite(n))throw std::runtime_error("READ_NONFINITE_VALUE");std::ostringstream s;s<<std::setprecision(17)<<n;return s.str();}
std::string guidBytes(const prPluginID& id){const auto* bytes=reinterpret_cast<const unsigned char*>(&id);std::ostringstream out;out<<std::hex<<std::setfill('0');for(size_t i=0;i<sizeof(id);i++)out<<std::setw(2)<<static_cast<unsigned>(bytes[i]);return out.str();}
std::string parameterJson(const PrParam& p){
 std::string value;
 switch(p.mType){
 case kPrParamType_Int8:value=std::to_string(p.mInt8);break;
 case kPrParamType_Int16:value=std::to_string(p.mInt16);break;
 case kPrParamType_Int32:value=std::to_string(p.mInt32);break;
 case kPrParamType_Int64:value=quote(std::to_string(p.mInt64));break;
 case kPrParamType_Float32:value=numeric(p.mFloat32);break;
 case kPrParamType_Float64:value=numeric(p.mFloat64);break;
 case kPrParamType_Bool:value=p.mBool?"true":"false";break;
 case kPrParamType_Point:value="{\"x\":"+numeric(p.mPoint.x)+",\"y\":"+numeric(p.mPoint.y)+"}";break;
 default:return "{\"type\":"+std::to_string(p.mType)+",\"status\":\"unsupported\"}";
 }
 return "{\"type\":"+std::to_string(p.mType)+",\"value\":"+value+"}";
}
struct Traversal {
 const PrSDKVideoSegmentSuite* sdk;const PrSDKMemoryManagerSuite* memory;
 const premiere_read::Request& request;ULONGLONG start=GetTickCount64();size_t count=0;std::set<csSDK_int32> ancestors;
 std::vector<std::string> nodes;
 void budget(){if(GetTickCount64()-start>8500||now()>=request.expires)throw std::runtime_error("READ_BUDGET_EXCEEDED");}
 std::string property(csSDK_int32 node,const char* key){
  budget();Property p{memory};if(sdk->GetNodeProperty(node,key,&p.value)!=0||!p.value)return {};
  const auto size=memory->GetPtrSize(p.value);if(size==0||size>4096)throw std::runtime_error("READ_PROPERTY_UNBOUNDED");
  const char* text=reinterpret_cast<const char*>(p.value);const size_t length=strnlen_s(text,size);if(length==size)throw std::runtime_error("READ_PROPERTY_UNTERMINATED");return {text,length};
 }
 void visit(csSDK_int32 id,const std::string& path,PrTime local,PrTime inputOffset,size_t depth){
  budget();if(++count>128||depth>12||!ancestors.insert(id).second)throw std::runtime_error("READ_GRAPH_UNBOUNDED");
  char type[kMaxNodeTypeStringSize]{};prPluginID hash{};csSDK_int32 flags=0;
  checked(sdk->GetNodeInfo(id,type,&hash,&flags),"READ_NODE_INFO_FAILED");
  if(strnlen_s(type,sizeof(type))==sizeof(type))throw std::runtime_error("READ_NODE_TYPE_UNBOUNDED");
  PrTime mapped=0;checked(sdk->TransformNodeTime(id,local,&mapped),"READ_TIME_TRANSFORM_FAILED");
  std::string result="{\"path\":"+quote(path)+",\"type\":"+quote(type)+",\"localTicks\":"+quote(std::to_string(local))+",\"inputOffsetTicks\":"+quote(std::to_string(inputOffset))+",\"mappedTicks\":"+quote(std::to_string(mapped))+",\"properties\":{";
  static const char* keys[]={"ClipNode::ClipSpeed","ClipNode::ClipBackwards","ClipNode::TimeRemapping","ClipNode::FrameHoldFilters","ClipNode::TrackID","ClipNode::TrackItemStartAsTicks","ClipNode::TrackItemEndAsTicks","ClipNode::EffectiveTrackItemStartAsTicks","ClipNode::EffectiveTrackItemEndAsTicks","ClipNode::FrameHoldAtTime","EffectNode::FilterMatchName","EffectNode::RuntimeInstanceID","EffectNode::RuntimeHash","EffectNode::ClipName","EffectNode::MasterClipName","EffectNode::FileName","MediaNode::ClipID","MediaNode::MediaInstanceString","MediaNode::InPointMediaTimeAsTicks","MediaNode::OutPointMediaTimeAsTicks"};
  bool first=true;std::string match,hold,holdFilters;
  for(const char* key:keys){const auto value=property(id,key);if(value.empty())continue;if(std::string(key)=="EffectNode::FilterMatchName")match=value;if(std::string(key)=="ClipNode::FrameHoldAtTime")hold=value;if(std::string(key)=="ClipNode::FrameHoldFilters")holdFilters=value;if(!first)result+=',';first=false;result+=quote(key)+':'+quote(value);}
  result+='}';
  PrTime effectTime=mapped,mediaTime=mapped;
  if(std::string(type)=="RenderableNodeClipImpl"){
   double rate=0;checked(sdk->GetNodeTimeScale(id,local,&rate),"READ_TIME_RATE_FAILED");result+=",\"timeRate\":"+numeric(rate);
   const auto clock=premiere_read::clipClock(mapped,rate,hold,holdFilters);effectTime=clock.effect;mediaTime=clock.media;
   if(clock.held)result+=",\"frameHoldClockProtocol\":1,\"effectTicks\":"+quote(std::to_string(effectTime))+",\"mediaTicks\":"+quote(std::to_string(mediaTime))+",\"effectTimeRate\":"+numeric(clock.effectRate);
  }
  if(match==request.match){
   budget();csSDK_int32 params=0;checked(sdk->GetParamCount(id,&params),"READ_PARAM_COUNT_FAILED");result+=",\"parameterCount\":"+std::to_string(params);
   if(request.parameter>=params)throw std::runtime_error("READ_PARAMETER_INDEX_ABSENT");
   PrParam param{};checked(sdk->GetParam(id,request.parameter,local,&param),"READ_PARAM_FAILED");
   // Opaque pointers are never dereferenced or exposed. No ownership is inferred.
   result+=",\"parameterIndex\":"+std::to_string(request.parameter)+",\"parameter\":"+parameterJson(param);
  }
  result+='}';nodes.push_back(std::move(result));
  csSDK_int32 inputs=0,operators=0;checked(sdk->GetNodeInputCount(id,&inputs),"READ_INPUT_COUNT_FAILED");checked(sdk->GetNodeOperatorCount(id,&operators),"READ_OPERATOR_COUNT_FAILED");
  if(inputs<0||operators<0||inputs>64||operators>64)throw std::runtime_error("READ_FANOUT_UNBOUNDED");
  for(csSDK_int32 i=0;i<operators;i++){budget();csSDK_int32 child=0;checked(sdk->AcquireOperatorNodeID(id,i,&child),"READ_OPERATOR_FAILED");Node owned(sdk,child);visit(child,path+"/o"+std::to_string(i),effectTime,0,depth+1);}
  for(csSDK_int32 i=0;i<inputs;i++){budget();PrTime offset=0;csSDK_int32 child=0;checked(sdk->AcquireInputNodeID(id,i,&offset,&child),"READ_INPUT_FAILED");Node owned(sdk,child);visit(child,path+"/i"+std::to_string(i),mediaTime-offset,offset,depth+1);}
  ancestors.erase(id);
 }
};
void publish(const std::string& id,const std::string& body){
 const std::wstring file=premiere_native::configuration().file(L"native-read-result.json"),temp=file+L".tmp";
 std::ofstream out(temp,std::ios::binary|std::ios::trunc);out<<"{\"protocol\":1,\"id\":"<<quote(id)<<",\"premierePid\":"<<GetCurrentProcessId()<<",\"at\":"<<now()<<","<<body<<"}";out.close();
 if(!out||!MoveFileExW(temp.c_str(),file.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw std::runtime_error("READ_RESULT_WRITE_FAILED");
}
void inspect(ecStdParms* params,void* value){
 std::lock_guard<std::mutex> lock(gate);
 // Consume a fixed request file before any SDK work. No idle scan or export.
 const std::wstring input=premiere_native::configuration().file(L"native-read-request.txt"),claimed=input+L".claimed";
 if(!MoveFileExW(input.c_str(),claimed.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)){lifecycle("request_unavailable",GetLastError());return;}
 lifecycle("request_claimed");
 std::string id;
 try{
  std::ifstream file(claimed,std::ios::binary);char buffer[1025];file.read(buffer,sizeof(buffer));const auto size=file.gcount();file.close();DeleteFileW(claimed.c_str());
  const auto request=premiere_read::parseRequest(std::string(buffer,static_cast<size_t>(size)),premiere_native::configuration().token,now());id=request.id;lifecycle("request_validated");
  seen.accept(request,now());
  if(!params||!params->piSuites||!params->piSuites->utilFuncs||!value)throw std::runtime_error("READ_TIMELINE_UNAVAILABLE");
  SPBasicSuite* basic=params->piSuites->utilFuncs->getSPBasicSuite();if(!basic)throw std::runtime_error("READ_BASIC_SUITE_UNAVAILABLE");
  Suite<PrSDKVideoSegmentSuite> video(basic,kPrSDKVideoSegmentSuite,kPrSDKVideoSegmentSuiteVersion);
  Suite<PrSDKMemoryManagerSuite> memory(basic,kPrSDKMemoryManagerSuite,kPrSDKMemoryManagerSuiteVersion);
  Suite<PrSDKApplicationSettingsSuite> settings(basic,kPrSDKApplicationSettingsSuite,kPrSDKApplicationSettingsSuiteVersion);
  Suite<PrSDKStringSuite> strings(basic,kPrSDKStringSuite,kPrSDKStringSuiteVersion);
  SdkString projectPath{strings.value};const auto projectStatus=settings.value->GetCurrentProjectPath(&projectPath.value);projectPath.allocated=projectStatus==0;
  const auto timeline=static_cast<ExportControllerTimelineInfoRec*>(value)->mTimelineID;
  Suite<PrSDKExportControllerSuite> controller(basic,kPrSDKExportControllerSuite,kPrSDKExportControllerSuiteVersion);
  prMosIDString mos{};const auto mosStatus=controller.value->RetrieveMosID(static_cast<ExportControllerTimelineInfoRec*>(value)->mModuleID,timeline,&mos);
  std::string mosId;if(mosStatus==0){if(wcsnlen_s(reinterpret_cast<const wchar_t*>(mos),kMosIDStringLength)==kMosIDStringLength)throw std::runtime_error("READ_TIMELINE_IDENTITY_UNBOUNDED");SdkString identity{strings.value};checked(strings.value->AllocateFromUTF16(mos,&identity.value),"READ_TIMELINE_IDENTITY_INVALID");identity.allocated=true;mosId=identity.utf8();}
  lifecycle("suites_acquired");Segments segments(video.value,timeline);prPluginID graphHash{};checked(video.value->GetHash(segments.id,&graphHash),"READ_GRAPH_HASH_FAILED");csSDK_int32 root=0;PrTime offset=0;
  checked(video.value->AcquireFirstNodeInTimeRange(segments.id,request.ticks,request.ticks+1,&root,&offset),"READ_SEGMENT_ABSENT");Node node(video.value,root);
  // For a one-tick range the returned offset advances with the requested time
  // (live start/+1 s observation). It is the acquired node's local time, not an
  // origin to subtract from sequence time. Keep this basis explicit in proof.
  lifecycle("segment_acquired");Traversal traversal{video.value,memory.value,request};traversal.visit(root,"root",offset,offset,0);traversal.budget();
  std::string body="\"status\":\"partial\",\"correlation\":\"required\",\"projectPath\":"+quote(projectStatus==0?projectPath.utf8():"")+",\"projectStatus\":"+std::to_string(projectStatus)+",\"mosId\":"+quote(mosId)+",\"mosStatus\":"+std::to_string(mosStatus)+",\"sequenceTicks\":"+quote(std::to_string(request.ticks))+",\"rootTimeBasis\":\"acquired_range_offset\",\"segmentOffsetTicks\":"+quote(std::to_string(offset))+",\"nodes\":[";
  for(size_t i=0;i<traversal.nodes.size();i++){if(i)body+=',';body+=traversal.nodes[i];}body+="],\"nativeTimeProtocol\":2,\"graphHash\":"+quote(guidBytes(graphHash));publish(id,body);lifecycle("read_completed",static_cast<long>(traversal.count));
 }catch(const std::exception& e){lifecycle(e.what());try{publish(id,"\"status\":\"unverified\",\"code\":"+quote(e.what()));}catch(...){lifecycle("result_write_failed");} }
}
}
extern "C" __declspec(dllexport) PrExportControllerResult xExportControllerEntry(PrExportControllerSelector selector,ecStdParms* params,void* value){
 lifecycle("selector",static_cast<long>(selector));
 try{
  if(selector==exportController_Startup){if(!value)return eExportControllerCannotInitialize;auto* init=static_cast<ExportControllerInitRec*>(value);const char16_t name[]=u"Premiere MCP Native Read";static_assert(sizeof(name)<=sizeof(init->mDisplayName));memcpy(init->mDisplayName,name,sizeof(name));return kExportControllerSuccess;}
  if(selector==exportController_ExportTimeline){inspect(params,value);return kExportControllerCancelSetup;}
  if(selector==exportController_Shutdown)return kExportControllerSuccess;
 }catch(...){}
 return kExportControllerSelectorUnsupported;
}
