// Bounded in-process investigation of the native Effect Controls provider.
// Only semantic accessibility and declared SDK commands; no synthetic input.
#include <oleacc.h>
#include <servprov.h>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;
struct AccessibleNode {
 ComPtr<IAccessible> object;
 std::string name,value;
 long role=0,state=0,left=0,top=0,width=0,height=0;
};
VARIANT selfChild(){VARIANT value{};value.vt=VT_I4;value.lVal=CHILDID_SELF;return value;}
std::string utf8(BSTR text){
 if(!text)return "";int n=WideCharToMultiByte(CP_UTF8,0,text,SysStringLen(text),nullptr,0,nullptr,nullptr);
 std::string result(n,'\0');if(n)WideCharToMultiByte(CP_UTF8,0,text,SysStringLen(text),result.data(),n,nullptr,nullptr);return result;
}
AccessibleNode observeAccessible(ComPtr<IAccessible> object){
 AccessibleNode node;node.object=object;BSTR text=nullptr;
 if(SUCCEEDED(object->get_accName(selfChild(),&text))){node.name=utf8(text);SysFreeString(text);}
 text=nullptr;if(SUCCEEDED(object->get_accValue(selfChild(),&text))){node.value=utf8(text);SysFreeString(text);}
 VARIANT value{};if(SUCCEEDED(object->get_accRole(selfChild(),&value))&&value.vt==VT_I4)node.role=value.lVal;VariantClear(&value);
 if(SUCCEEDED(object->get_accState(selfChild(),&value))&&value.vt==VT_I4)node.state=value.lVal;VariantClear(&value);
 object->accLocation(&node.left,&node.top,&node.width,&node.height,selfChild());return node;
}
std::vector<AccessibleNode> accessibleChildren(IAccessible* root){
 long count=0;if(FAILED(root->get_accChildCount(&count))||count<0||count>512)throw std::runtime_error("EFFECT_CHILD_COUNT_UNBOUNDED");
 std::vector<VARIANT> values(count);long obtained=0;
 if(count&&FAILED(AccessibleChildren(root,0,count,values.data(),&obtained)))throw std::runtime_error("EFFECT_CHILDREN_UNAVAILABLE");
 std::vector<AccessibleNode> nodes;
 for(long i=0;i<obtained;i++){
  if(values[i].vt==VT_DISPATCH&&values[i].pdispVal){ComPtr<IAccessible> child;if(SUCCEEDED(values[i].pdispVal->QueryInterface(IID_PPV_ARGS(&child))))nodes.push_back(observeAccessible(child));}
  VariantClear(&values[i]);
 }
 if(obtained!=count||nodes.size()!=static_cast<size_t>(count))throw std::runtime_error("EFFECT_CHILDREN_INCOMPLETE");return nodes;
}
struct EffectPanel {
 HWND window=nullptr;
 ComPtr<IAccessible> root;
 std::vector<AccessibleNode> children,headers;
 AccessibleNode scroll;
};
struct PanelSearch {std::vector<std::pair<HWND,ComPtr<IAccessible>>> matches;DWORD pid=GetCurrentProcessId();unsigned count=0;bool incomplete=false;};
BOOL CALLBACK findEffectWindow(HWND window,LPARAM data){
 auto& search=*reinterpret_cast<PanelSearch*>(data);if(++search.count>180){search.incomplete=true;return FALSE;}
 DWORD pid=0;GetWindowThreadProcessId(window,&pid);if(pid!=search.pid||!IsWindowVisible(window))return TRUE;
 ComPtr<IAccessible> root;if(SUCCEEDED(AccessibleObjectFromWindow(window,OBJID_CLIENT,IID_IAccessible,reinterpret_cast<void**>(root.GetAddressOf())))){
  auto node=observeAccessible(root);if(node.name=="Effect Controls")search.matches.push_back({window,root});
 }return TRUE;
}
BOOL CALLBACK findEffectTopWindow(HWND window,LPARAM data){DWORD pid=0;GetWindowThreadProcessId(window,&pid);if(pid==GetCurrentProcessId()&&IsWindowVisible(window))EnumChildWindows(window,findEffectWindow,data);return TRUE;}
EffectPanel inspectEffectPanel(const std::string& target){
 if(target.empty()||target.size()>1800||target.find_first_of("\t\r\n")!=std::string::npos)throw std::runtime_error("EXACT_SELECTED_CLIP_TAB_REQUIRED");
 PanelSearch search;EnumWindows(findEffectTopWindow,reinterpret_cast<LPARAM>(&search));
 if(search.incomplete||search.matches.size()!=1)throw std::runtime_error("NATIVE_EFFECT_PANEL_NOT_UNIQUE");
 EffectPanel panel;panel.window=search.matches[0].first;panel.root=search.matches[0].second;panel.children=accessibleChildren(panel.root.Get());
 unsigned targets=0,scrolls=0;
 for(size_t i=0;i<panel.children.size();i++){
  auto& node=panel.children[i];if(node.name==target)targets++;
  if(node.name=="UI_ScrollBar"){panel.scroll=node;scrolls++;}
  if(i&&((node.name=="효과 켜기/끄기")||(node.name=="Toggle the effect on or off"))&&panel.children[i-1].name=="UI_DisclosureTriangleButton")panel.headers.push_back(panel.children[i-1]);
 }
 if(targets!=1)throw std::runtime_error("NATIVE_SELECTED_CLIP_MISMATCH");
 if(panel.headers.empty()||panel.headers.size()>32||scrolls!=1)throw std::runtime_error("NATIVE_EFFECT_LAYOUT_UNVERIFIED");return panel;
}
std::string effectPanelJson(const EffectPanel& panel){
 std::string headers="[";bool first=true;for(const auto& h:panel.headers){if(!first)headers+=',';first=false;headers+="{\"expanded\":"+std::string((h.state&STATE_SYSTEM_PRESSED)?"true":"false")+",\"state\":"+std::to_string(h.state)+",\"top\":"+std::to_string(h.top)+",\"height\":"+std::to_string(h.height)+"}";}headers+=']';
 ComPtr<IServiceProvider> provider;HRESULT accessibleEx=panel.headers[0].object.As(&provider);ComPtr<IUnknown> extension;
 if(SUCCEEDED(accessibleEx)){const GUID iid={0xf8b80ada,0x2c44,0x48d0,{0x89,0xbe,0x5f,0xf2,0x3c,0x9c,0xd8,0x75}};accessibleEx=provider->QueryService(iid,iid,reinterpret_cast<void**>(extension.GetAddressOf()));}
 return "{\"panelHandle\":"+std::to_string(reinterpret_cast<uintptr_t>(panel.window))+",\"headers\":"+headers+",\"scrollValue\":"+quote(panel.scroll.value)+",\"accessibleExHresult\":"+std::to_string(accessibleEx)+"}";
}
bool effectFeature(const std::string& feature){return feature=="inspect_effect_controls"||feature=="effect_expand_first"||feature=="effect_collapse_first"||feature=="effect_video_group_toggle"||feature=="effect_scroll_down"||feature=="effect_scroll_up";}
