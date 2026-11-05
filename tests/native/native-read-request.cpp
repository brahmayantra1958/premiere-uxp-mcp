#include "NativeReadRequest.h"
#include "NativeClipClock.h"
#include <iostream>
#include <vector>
int main(){
 const std::string token(64,'a'),id="01234567-89ab-cdef-0123-456789abcdef";
 const auto make=[&](std::string nonce,std::string expiry,std::string ticks,std::string match,std::string param){return token+"\n"+nonce+"\n"+expiry+"\n"+ticks+"\n"+match+"\n"+param;};
 const auto valid=make(id,"11000","3534353222400","AE.ADBE Tint","1");
 const auto parsed=premiere_read::parseRequest(valid,token,10000);
 if(parsed.id!=id||parsed.parameter!=1||parsed.ticks!=3534353222400LL)return 1;
 std::vector<std::string> invalid={valid+"\nextra",valid+"\n\n",std::string(1025,'a'),
  make(std::string(36,'-'),"11000","0","fx","0"),make(id,"10000","0","fx","0"),
  make(id,"25001","0","fx","0"),make(id,"11000",std::to_string(254016000000LL*86400*7+1),"fx","0"),
  make(id,"11000","-1","fx","0"),make(id,"11000","0","fx","4096"),
  make(id,"11000","0","","0"),make(id,"11000","0",std::string(201,'a'),"0"),
  make(id,"11000","0","fx\r","0"),make(id,"11000","0","fx\npath","0"),
  make(id,"9999999999999999999","0","fx","0")};
 for(const auto& request:invalid){bool rejected=false;try{premiere_read::parseRequest(request,token,10000);}catch(const std::exception&){rejected=true;}if(!rejected){std::cerr<<"accepted invalid request\n";return 2;}}
 try{premiere_read::parseRequest(valid,std::string(64,'b'),10000);return 3;}catch(const std::exception&){}
 premiere_read::ReplayWindow seen;seen.accept(parsed,10000);
 try{seen.accept(parsed,10001);return 4;}catch(const std::exception& e){if(std::string(e.what())!="READ_REQUEST_REPLAY")return 5;}
 try{seen.accept(parsed,11000);return 6;}catch(const std::exception&){}
 // More than one old session's worth of ordinary reads never needs a restart.
 for(int i=0;i<5000;i++){const auto now=11000LL+i*100;auto request=parsed;request.id=std::to_string(i);request.expires=now+15000;seen.accept(request,now);}
 if(seen.size()>150)return 7;
 premiere_read::ReplayWindow burst;
 for(int i=0;i<1024;i++){auto request=parsed;request.id=std::to_string(i);burst.accept(request,10000);}
 try{auto request=parsed;request.id="over";burst.accept(request,10000);return 8;}catch(const std::exception& e){if(std::string(e.what())!="READ_ACTIVE_REQUEST_LIMIT")return 9;}
 auto renewed=parsed;renewed.expires=12000;burst.accept(renewed,11000);if(burst.size()!=1)return 10;
 const auto moving=premiere_read::clipClock(500,-2,"","");if(moving.held||moving.effect!=500||moving.media!=500||moving.effectRate!=-2)return 11;
 const auto both=premiere_read::clipClock(500,.72,"6127881983","1");if(!both.held||both.effect!=6127881983LL||both.media!=both.effect||both.effectRate!=0)return 12;
 for(const auto& flag:std::vector<std::string>{"","0"}){const auto mediaOnly=premiere_read::clipClock(500,.72,"0",flag);if(!mediaOnly.held||mediaOnly.effect!=500||mediaOnly.media!=0||mediaOnly.effectRate!=.72)return 13;}
 for(const auto& time:std::vector<std::string>{"-","1.5"," 1","1x","9223372036854775808"}){try{premiere_read::clipClock(500,1,time,"1");return 14;}catch(const std::exception&){}}
 try{premiere_read::clipClock(500,1,"","1");return 15;}catch(const std::exception&){}
 try{premiere_read::clipClock(500,1,"1","true");return 16;}catch(const std::exception&){}
 std::cout<<"PASS: native request codec, replay/expiry/active cap, 5000 sustained reads, independent frame/effect hold clocks\n";
}
