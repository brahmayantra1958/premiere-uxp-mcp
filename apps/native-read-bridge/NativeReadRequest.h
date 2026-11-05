#pragma once
#include <string>
#include <sstream>
#include <stdexcept>
#include <algorithm>
#include <cstdint>
#include <map>

namespace premiere_read {
struct Request {std::string id,match;std::int64_t expires,ticks;int parameter;};
// Valid replay protection lasts only as long as the authenticated request can
// still be accepted. Expired requests are rejected by parseRequest, so retaining
// their nonces until application restart adds no protection and exhausts usage.
class ReplayWindow {
 std::map<std::string,std::int64_t> entries;
public:
 void accept(const Request& request,std::int64_t now){
  if(request.expires<=now||request.expires-now>15000)throw std::runtime_error("READ_REQUEST_RANGE");
  for(auto it=entries.begin();it!=entries.end();)if(it->second<=now)it=entries.erase(it);else ++it;
  if(entries.find(request.id)!=entries.end())throw std::runtime_error("READ_REQUEST_REPLAY");
  if(entries.size()>=1024)throw std::runtime_error("READ_ACTIVE_REQUEST_LIMIT");
  entries.emplace(request.id,request.expires);
 }
 size_t size()const{return entries.size();}
};
inline bool digits(const std::string& s){return !s.empty()&&s.size()<=18&&std::all_of(s.begin(),s.end(),[](char c){return c>='0'&&c<='9';});}
// Fixed six-line protocol: no paths, scripts, commands or native node IDs.
inline Request parseRequest(const std::string& text,const std::string& token,std::int64_t now){
 if(text.size()>1024)throw std::runtime_error("READ_REQUEST_UNBOUNDED");
 std::istringstream input(text);std::string fields[6],extra;
 for(auto& field:fields){if(!std::getline(input,field)||field.find('\r')!=std::string::npos)throw std::runtime_error("READ_REQUEST_FORMAT");}
 if(std::getline(input,extra)||fields[0]!=token)throw std::runtime_error("READ_REQUEST_AUTH_OR_FIELDS");
 if(fields[1].size()!=36)throw std::runtime_error("READ_REQUEST_ID");
 for(size_t i=0;i<36;i++){const char c=fields[1][i];const bool separator=i==8||i==13||i==18||i==23;if(separator?c!='-':!((c>='0'&&c<='9')||(c>='a'&&c<='f')))throw std::runtime_error("READ_REQUEST_ID");}
 if(!digits(fields[2])||!digits(fields[3])||!digits(fields[5]))throw std::runtime_error("READ_REQUEST_NUMBER");
 const auto expiry=std::stoll(fields[2]),ticks=std::stoll(fields[3]),parameter=std::stoll(fields[5]);
 if(expiry<=now||expiry-now>15000||ticks>254016000000LL*86400*7||parameter>4095)throw std::runtime_error("READ_REQUEST_RANGE");
 if(fields[4].empty()||fields[4].size()>200||!std::all_of(fields[4].begin(),fields[4].end(),[](unsigned char c){return c>=32&&c<127;}))throw std::runtime_error("READ_REQUEST_MATCH");
 return {fields[1],fields[4],expiry,ticks,static_cast<int>(parameter)};
}
}
