#pragma once
#include <stdexcept>
#include <string>
#include <vector>

// Versioned installation data, never command input. Both SDK plugins use exactly
// these three fields; filenames and command allowlists remain compiled constants.
namespace premiere_native {
struct Settings { std::string token, runtimeDirectory; };
inline Settings parseSettings(const std::string& bytes) {
 if(bytes.empty()||bytes.size()>32768||bytes.back()!='\n')throw std::runtime_error("NATIVE_CONFIG_FORMAT");
 std::vector<std::string> lines;size_t start=0;
 for(size_t end=0;(end=bytes.find('\n',start))!=std::string::npos;start=end+1)lines.push_back(bytes.substr(start,end-start));
 if(lines.size()!=3||lines[0]!="PREMIERE_UXP_MCP_NATIVE_V1")throw std::runtime_error("NATIVE_CONFIG_VERSION");
 if(lines[1].size()!=64||lines[1].find_first_not_of("0123456789abcdef")!=std::string::npos)throw std::runtime_error("NATIVE_CONFIG_TOKEN");
 const auto& directory=lines[2];
 if(directory.size()<3||directory.size()>16000||!((directory[0]>='A'&&directory[0]<='Z')||(directory[0]>='a'&&directory[0]<='z'))||directory[1]!=':'||directory[2]!='\\')throw std::runtime_error("NATIVE_CONFIG_LOCAL_PATH");
 for(size_t i=2;i<directory.size();i++)if(static_cast<unsigned char>(directory[i])<32||directory[i]==':'||directory[i]=='/'||directory[i]=='*'||directory[i]=='?'||directory[i]=='"'||directory[i]=='<'||directory[i]=='>'||directory[i]=='|')throw std::runtime_error("NATIVE_CONFIG_PATH_CHARACTER");
 for(size_t i=3;i<directory.size();){const auto end=directory.find('\\',i);const auto part=directory.substr(i,end==std::string::npos?end:end-i);if(part.empty()||part.back()=='.'||part.back()==' ')throw std::runtime_error("NATIVE_CONFIG_PATH_COMPONENT");if(end==std::string::npos)break;i=end+1;}
 const std::string suffix="\\artifacts\\runtime";
 if(directory.size()<=suffix.size()||directory.compare(directory.size()-suffix.size(),suffix.size(),suffix)!=0)throw std::runtime_error("NATIVE_CONFIG_RUNTIME_DIRECTORY");
 return {lines[1],directory};
}
}
