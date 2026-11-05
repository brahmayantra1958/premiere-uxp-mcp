#pragma once
#include <windows.h>
#include <shlobj.h>
#include <fstream>
#include <vector>
#include "NativeRuntimeSettings.h"

namespace premiere_native {
inline std::wstring utf16(const std::string& value) {
 const int size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),nullptr,0);
 if(!size)throw std::runtime_error("NATIVE_CONFIG_UTF8");std::wstring out(size,L'\0');
 if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),out.data(),size))throw std::runtime_error("NATIVE_CONFIG_UTF8");return out;
}
inline void requirePlainPath(const std::wstring& value,bool directory) {
 for(size_t end=3;end<=value.size();){const auto next=value.find(L'\\',end);const auto path=value.substr(0,next);const auto attributes=GetFileAttributesW(path.c_str());
  if(attributes==INVALID_FILE_ATTRIBUTES||(attributes&FILE_ATTRIBUTE_REPARSE_POINT))throw std::runtime_error("NATIVE_CONFIG_LINK_OR_MISSING_PATH");
  if(next==std::wstring::npos){if(bool(attributes&FILE_ATTRIBUTE_DIRECTORY)!=directory)throw std::runtime_error("NATIVE_CONFIG_PATH_TYPE");break;}end=next+1;
 }
}
struct Configuration {
 std::string token;std::wstring runtimeDirectory;
 std::wstring file(const wchar_t* name)const{return runtimeDirectory+L"\\"+name;}
};
inline Configuration loadConfiguration() {
 PWSTR local=nullptr;if(FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData,KF_FLAG_DEFAULT,nullptr,&local)))throw std::runtime_error("NATIVE_CONFIG_LOCAL_APP_DATA");
 const std::wstring file=std::wstring(local)+L"\\PremiereUxpMcp\\native-bridge-v1.txt";CoTaskMemFree(local);
 requirePlainPath(file,false);
 std::ifstream input(file,std::ios::binary);std::vector<char> bytes(32769);input.read(bytes.data(),static_cast<std::streamsize>(bytes.size()));
 const auto count=input.gcount();if(input.bad()||count<=0||count>32768)throw std::runtime_error("NATIVE_CONFIG_READ");
 const auto settings=parseSettings(std::string(bytes.data(),static_cast<size_t>(count)));const auto directory=utf16(settings.runtimeDirectory);requirePlainPath(directory,true);
 return {settings.token,directory};
}
// One immutable binding per host process. Moving/switching an installation
// requires a normal host restart; a request cannot redirect this binding.
inline const Configuration& configuration(){static const auto value=loadConfiguration();return value;}
}
