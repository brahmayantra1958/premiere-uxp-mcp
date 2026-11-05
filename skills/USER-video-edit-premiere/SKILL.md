---
name: USER-video-edit-premiere
description: "Premiere의 클립·효과·그래픽을 MCP로 조회하고 편집하기. 현재 대상을 고정하고 필요한 조회·명령 묶음·이벤트 대기와 호스트 검증으로 실제 편집을 수행한다."
metadata:
  contract_version: "1.0.0"
  display_name: "Premiere MCP 영상 편집"
  version: "1.0.10"
---

# Premiere MCP 영상 편집

실제 Premiere 편집 요청에 사용한다. MCP 코드 개발이나 일반 영상 조언에는 호스트 실행을 시작하지 않는다.

1. 연결된 MCP를 재사용한다. 첫 대상 조회는 get_agent_context다. 실제 tools/list와 premiere_ping의 panelVersion·panelMode·배포 경로를 확인하고, 첫 편집 전 get_mutation_recovery를 읽는다. 준비된 소스 버전과 실행 중 패널을 구분한다.
   원본 배치 전 placementCapabilities.sourceRange.status를 확인한다. pass일 때만 sourceRange를 선택하며 영상은 videoStatus와 renderChecks도 필요하다. 이 필드가 없으면 get_capabilities.write에서 sourceRangePlacement:true를 직접 확인한다. 같은 패널 버전 표기나 tools/list만으로 지원을 추정하지 않는다. 미지원 시 원본 전체 배치+정확한 trim의 조건은 [타임라인](references/timeline.md)을 따른다. 실행 중인 제작을 배포·Reload로 중단하지 않는다.
2. 사용자 요청의 결과·보존 조건을 정하고 fresh project/sequence IDs로 후속 명령을 고정한다. 과거 작업의 ID·패널 버전·작품 값을 새 인자로 복사하지 않는다. context.status:"ready"·editBoundary.allowed:true와 요청 대상의 일치를 확인한다. ready/editBoundary.allowed는 실행 가능성이지 작업 승인 범위가 아니다. 기존 로컬 프로젝트·시퀀스에는 이름 접두사나 대상별 재설정이 필요 없다.
3. [대상과 미디어](references/targets-media.md)에 따라 필요한 클립만 조회한다. 값·식별자·단위·키 존재를 관측하고 [실행 참고](references/execution-recipes.md)로 인자를 조립한다.
4. 원본 타이밍·사운드·후속 구도 조절을 보존한다. 가로→세로 작업은 원본 화면을 유지하고 Motion으로 조정한다. 지정 비율과 fill이 충돌하면 지정값을 적용하고 차이를 알린다. [모션과 재구도](references/motion-reframe.md)를 읽는다.
   **배치는 원본 전체 파일 + 인·아웃이 기본이다. 컷 길이로 미리 자른 파일을 놓지 않는다.** 사용자 요청으로 파생본을 쓰는 예외에도 앞뒤 1초 이상 여유와 원본 경로·구간 대응을 기록한다. 불가능한 여유는 이유와 부족량을 먼저 설명한다. 도구 장애만으로 편집 가능성을 줄이지 않는다. 원본 sourceRange와 알려진 실패의 우회 순서는 [타임라인](references/timeline.md)을 따른다.
5. 단일 값은 단일 명령, 같은 효과의 값들은 한 parameters 배열, 반복 작업은 [명령 묶음과 이벤트](references/jobs-events.md)를 사용한다. native 쓰기를 겹치지 않는다.
6. terminal receipt의 실제 값·보존을 확인하고 필요한 프레임/음성/화면 근거를 추가한다. 이미 증명된 항목은 반복 조회하지 않는다. [검증·저장·납품](references/verify-deliver.md)을 따른다.
   **배치 뒤 각 클립의 남은 여유를 읽어 보고, 0이면 이유를 말한다.** unknown/null은 미확인으로 남긴다.
7. 마지막 작업 위치에 남는다. 일반 확인은 화면을 유지하고 지정 대상 조회·편집은 따라간다. 일반 follow 실패는 콘텐츠 결과와 분리한다. 요청 없는 복원 호출을 붙이지 않는다.
8. dispatch 뒤 timeout은 UNVERIFIED다. 활성 작업은 기다리고, 종료된 작업은 정확한 root ID의 공식 archive로 lease를 해제할 수 있다. 현재 영향을 확인한 뒤 필요한 수정만 새 의도로 실행한다. [복구](references/recovery.md)를 따른다.

## 필요한 기능만 읽기

| 요청 | 참고 |
|---|---|
| 배치·이동·분할·트랙·ripple | [타임라인](references/timeline.md) |
| 효과·키프레임·색상·오디오 | [효과](references/effects.md) |
| SRT·기존 캡션·MOGRT·전사 | [캡션과 그래픽](references/captions-graphics.md) |
| Object Mask·native 도구 | [마스크](references/masks-native.md) |

이 폴더의 상대 링크는 설치본만으로 읽을 수 있다. 저장소가 없는 클라이언트는 MCP resources/list의 premiere://guide/contract와 기능별 resource를 사용한다. 실제 스키마와 capability를 우선하며 미지원 기능을 추측하지 않는다.

## 경계와 완료

- 명시된 절대 미디어 경로는 로컬/NAS에서 읽기 전용이다. 생성물은 도구의 artifact 경계를 지킨다.
- 프로필은 inspect 기본, 편집 edit, 공개 저장/닫기/열기/내보내기 delivery다. 프로필 변경은 MCP 재연결이며 UXP 재설치가 아니다.
- 프로필 노출·ready 상태·설치된 이 스킬은 작업 승인이 아니며 설치·관리자·보안 설정 변경 권한을 주지 않는다. 요청이 이미 승인한 작업은 다시 승인받지 않는다.
- 정상 편집 중에 요청과 무관한 편집·설치·재빌드·재시작·Reload를 끼워 넣지 않는다.
- 임의 CEP/QE/script·합성 입력·보안 우회로 미지원 기능을 대신하지 않는다.
- Computer Use는 실제 UI 근거가 필요할 때만 사용하고 비UI 작업·대기 전에 공식 정리한다. 제공된다면 USER-computer-use-manage-memory를 적용한다.
- 요청별 PASS/PARTIAL/FAIL/UNVERIFIED/UNSUPPORTED, 정확한 대상·operation/job ID·cursor·증거와 남은 작업을 인계한다. 성공 boolean·접수·파일 존재·도구 활성화를 편집 완료로 보고하지 않는다.
