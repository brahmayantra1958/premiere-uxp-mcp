#pragma once
#include <cstdint>
#include <cmath>
#include <string>
#include <stdexcept>

namespace premiere_read {
struct ClipClock {std::int64_t media,effect;double effectRate;bool held;};
// TransformNodeTime includes retiming but does not apply Frame Hold Options.
// Adobe exposes the held native time and the independent Hold Filters switch.
// Media always holds; effect operators hold only when that switch is enabled.
inline ClipClock clipClock(std::int64_t mapped,double rate,const std::string& hold,const std::string& filters){
 if(!std::isfinite(rate)||(!filters.empty()&&filters!="0"&&filters!="1"))throw std::runtime_error("READ_HOLD_CLOCK_INVALID");
 if(hold.empty()){
  if(filters=="1")throw std::runtime_error("READ_HOLD_TIME_MISSING");
  return {mapped,mapped,rate,false};
 }
 const auto begin=hold[0]=='-'?1u:0u;
 if(hold.size()<=begin||hold.size()>19||hold.find_first_not_of("0123456789",begin)!=std::string::npos)throw std::runtime_error("READ_HOLD_TIME_INVALID");
 std::size_t consumed=0;const auto time=std::stoll(hold,&consumed);
 if(consumed!=hold.size())throw std::runtime_error("READ_HOLD_TIME_INVALID");
 return {time,filters=="1"?time:mapped,filters=="1"?0:rate,true};
}
}
