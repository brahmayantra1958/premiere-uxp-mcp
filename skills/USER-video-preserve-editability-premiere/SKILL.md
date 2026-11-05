---
name: USER-video-preserve-editability-premiere
description: "Premiere 재구도·소스 교체에서 원본과 후속 편집 가능성을 보존하기. 기준 원본·컷·사운드·효과를 고정하고 모션 기반 편집과 변경 전후 검증으로 결과를 만든다."
metadata:
  contract_version: "1.0.0"
  display_name: "Premiere 원본·편집 가능성 보존"
  version: "1.0.2"
---

# 원본과 후속 편집 가능성 보존

원본 타이밍/사운드 기반 재편집, 가로→세로, 소스 교체, 나중에 조절할 수 있는 편집 요청에 사용한다. 단순 파일 조회·MCP 연결·완성본 변환만으로 이 흐름을 강제하지 않는다.

1. 기준 원본과 변형본을 구분한다. 원본 구간→사용 소스→타임라인 구간의 대응을 현재 파일/기록으로 확인한다. 과거 편집표는 찾는 단서이며 요청한 원본을 대체하지 않는다.
   **배치는 원본 전체 파일 + 인·아웃이 기본이다. 컷 길이로 미리 자른 파일을 놓지 않는다.** 사용자가 원할 때만 예외로 하고 그때도 앞뒤 1초 이상 여유와 원본 경로·구간 대응을 기록한다. 원본 끝이라 여유가 부족하면 부족한 쪽과 이유를 알리고 범위를 합의한다. `_편집용_<n>f`, `조각`, `_f<시작>-<끝>` 이름을 원본으로 간주하지 않는다.
2. 변경할 항목과 보존할 항목을 적는다: sequence 규격, timeline/source 범위, 오디오 source·속도·gain/effects, 효과·키, A/V 관계, 원본 화면 영역, 이후 조절할 값.
3. 기본 재구도는 원본 화면을 유지한 미디어와 Premiere Motion으로 구현한다. 구도를 굽는 출력이 명시되거나 선택된 변환에 필요할 때는 별도 파생 파일을 사용하고 그 범위를 설명한다.
4. fill/fit/명시적 scale을 구분한다. 특정 비율과 화면 채움이 함께 성립하지 않으면 비율을 적용하고 차이를 알린다. 사용자 교정을 실제 소스와 실행 인자에 반영한다.
5. 실제 MCP 스키마와 helper/capability에서 지원 경로를 고른다. 전용 replace/relink 도구를 지어내지 않는다. 필요한 재배치는 source range·timing·effects·keys·audio/link 보존 계획으로 제한한다.
6. 모션 값 readback과 결과 프레임을 함께 확인한다. 원본 타이밍/오디오 보존은 별도로 검증한다. 파생 파일 존재·클립 수만으로 요청 충족을 판정하지 않는다.
   **배치 뒤 각 클립의 남은 여유를 읽어 보고, 0이면 이유를 말한다.** 배치/trim의 editability.handles는 파일 기준이며 null은 미확인이다. hard subclip·retime·링크 때문에 실제 드래그 확장이 제한될 수 있어 extensionVerified:false를 확장 성공으로 바꾸지 않는다.

## 알려진 실패와 기본 우회

원본 보존과 구현 경로의 지원 여부를 구분한다. get_agent_context.placementCapabilities.sourceRange.status가 pass일 때만 sourceRange를 선택한다(영상은 videoStatus도 pass). 필드 없는 서버에서는 get_capabilities.write의 sourceRangePlacement:true를 직접 확인한다. 같은 panelVersion 또는 tools/list는 기능 증명이 아니다. 조회 실패는 UNVERIFIED로 남긴다. 미지원이어도 전체 원본을 유지하며, sequenceEditor·exactClipTrim 지원과 모든 삽입 스트림의 임시 전체 길이 빈 공간을 입증한 경우에만 원본 배치→정확한 trim을 선택한다. head trim으로 시작이 이동하는 양까지 계산한다. 조건 불충족 시 승인된 scratch/수동 편집으로 넘긴다. 자동 우회·사전 절단·제작 중 Reload/배포는 하지 않는다.

create_subclip F의 생성 항목 없음은 원인 UNVERIFIED, A1 split/ripple 인점 있는 뒷조각의 검은 렌더는 clone/lift 수정 후 라이브 UNVERIFIED다. 중간 source subclip의 효과 시간 대응에서 SDK_CLIP_IDENTITY_AMBIGUOUS가 발생한 사례도 있다. 이를 피하려고 컷 길이 영상·음성 파일로 굽지 않는다.

권장 순서는 지원 확인된 원본 ProjectItem + place_clips.sourceRange → 위의 전체 임시 범위 조건을 입증한 원본 배치 + trim_clip_exact → 승인된 scratch/수동 원본 편집이다. sourceRange는 한 항목, 빈 기존 트랙 구간, overwrite와 정확한 source/timeline guard를 사용한다. 영상 최종 PASS에는 독립 검수한 capture_program_frame 기준의 renderChecks(timeSeconds,expectedSha256)가 필요하다. 새 결과에서 스스로 만든 해시는 기준이 아니다. 첫·중간·끝 표본과 음성을 따로 검증한다. SDK identity가 모호하면 guard를 유지하고 수동 효과 편집으로 넘긴다.

편집 가능성을 깎는 우회는 손실을 알리고 사용자의 명시적 선택 뒤에만 한다. 파생본→원본 자동 교체는 현재 도구로 위치·길이·링크·효과 보존을 증명할 수 없다. ProjectItem 경로 변경은 모든 사용처에 영향을 주며 source offset을 변환하지 않는다. 수동 교체에서도 원본 파일 상대 구간·A/V 연결·효과와 키프레임 시간·전환·속도·앞뒤 여유를 각각 확인하고 기존 항목을 검증 전에 삭제하지 않는다.

MCP 실행에는 제공된 USER-video-edit-premiere 또는 premiere://guide/contract를 따른다. 어떤 수치·인물·언어·컷 개수도 작품 간 기본값으로 복사하지 않는다.

## 사례 적용
- “세로로 꽉 채우고 나중에 구도 조절”: 가로 source 유지, native Motion 크기·위치 사용.
- “타이밍·소리는 그대로, 비율은 모두 50”: 컷과 audio 고정, 관측한 Motion scale을 50으로 설정, 빈 영역 여부를 명시.
- “완성본을 9:16으로 크롭해 내보내기”: 요청한 파생 출력 생성, 원본 보존. 편집용 source까지 교체하지 않는다.
- “기존 효과만 바꾸기”: 타이밍/소스/다른 효과·키를 유지하고 정확한 effect instance만 수정.

완료는 요청 결과와 각 보존 조건의 직접 증거로 판단한다. 확인할 수 없는 소리·구도·링크 상태는 UNVERIFIED로 남긴다.
