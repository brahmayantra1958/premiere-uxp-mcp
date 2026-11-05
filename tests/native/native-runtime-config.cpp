#include "NativeRuntimeSettings.h"
#include <iostream>
int main(){
 const std::string header="PREMIERE_UXP_MCP_NATIVE_V1\n",token(64,'a');
 const auto make=[&](const std::string& directory){return header+token+"\n"+directory+"\n";};
 for(const std::string path:{"C:\\portable\\artifacts\\runtime",u8"D:\\설치 공백\\artifacts\\runtime"}){const auto config=premiere_native::parseSettings(make(path));if(config.token!=token||config.runtimeDirectory!=path)return 1;}
 for(const std::string path:{"relative\\artifacts\\runtime","\\\\server\\share\\artifacts\\runtime","\\\\?\\C:\\x\\artifacts\\runtime","C:\\x\\..\\artifacts\\runtime","C:\\x.\\artifacts\\runtime","C:\\x \\artifacts\\runtime","C:\\x\\artifacts\\runtime:stream","C:\\x/artifacts/runtime","C:\\x\\other","C:\\x\nredirect\\artifacts\\runtime","C:\\x\\\\artifacts\\runtime"}){try{premiere_native::parseSettings(make(path));std::cerr<<"accepted invalid path\n";return 2;}catch(const std::exception&) {}}
 const auto valid=make("C:\\portable\\artifacts\\runtime");
 for(const auto& invalid:{valid+"extra\n",valid.substr(0,valid.size()-1),std::string(32769,'a'),std::string("BAD\n")+token+"\nC:\\x\\artifacts\\runtime\n",header+std::string(64,'G')+"\nC:\\x\\artifacts\\runtime\n"}){try{premiere_native::parseSettings(invalid);return 3;}catch(const std::exception&) {}}
 std::cout<<"native runtime configuration tests passed\n";
}
