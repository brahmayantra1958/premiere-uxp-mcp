# Premiere MCP 현재 운영 계약
계약 버전 **1.0.0**. 이 문서와 연결된 현재 스킬이 배포 운영 정본이다. 과거 개발일지의 제한·작품 값·승인 기록은 새 설치의 설정이나 권한이 아니다. 실제 인자는 연결된 tools/list, 기능 사용 가능성은 해당 설치의 capability와 응답으로 확인한다.

## 대상과 편집 의도
- 사용자 요청의 결과와 보존할 항목을 먼저 특정한다. 타이밍·원본 사운드·효과·편집 가능성을 각각 다룬다.
- **배치는 원본 전체 파일 + 인·아웃이 기본이다. 컷 길이로 미리 자른 파일을 놓지 않는다.** 사용자가 파생본을 원할 때만 예외로 하며, 그때도 앞뒤 1초 이상 여유와 원본 경로·원본 구간 대응을 기록한다. 원본 끝이라 여유 확보가 불가능하면 부족한 쪽과 이유를 알리고 범위를 합의한다. 도구 오류 회피는 파생본 사용 동의가 아니다.
- get_agent_context로 현재 프로젝트·시퀀스를 발견하고 후속 명령은 expectedProjectId/expectedSequenceId 및 도구별 정확한 클립 guard를 전달한다.
- 저장된 로컬 프로젝트와 기존 시퀀스를 재사용한다. WORKING__ 접두사·프로젝트 allowlist·대상 변경 재페어링/재빌드는 요구하지 않는다. 새 시퀀스/복사본은 요청이나 실제 작업 필요에 따라 만든다.
- 작업 중 대상 변화는 명령의 재획득·readback으로 판정한다. 사용자의 탐색 자체를 실패나 복원 요청으로 취급하지 않는다.
- 가로→세로 구도는 원본 화면을 유지하고 Premiere Motion으로 조정한다. 구도를 굽는 출력이 요청되거나 선택된 변환에 필요할 때만 별도 파생 파일로 만든다. 원본은 덮어쓰지 않는다.

## 조회와 실행
- 전체 스냅샷은 전체 증거가 필요한 경우에만 쓴다. query_timeline 기본 20/최대 100, 효과 또는 소스 메타데이터 포함 시 최대 20이다. query_media 최대 100이다.
- hasMore/scanTruncated를 확인하고 각 도구의 cursor/offset을 따른다. 빈 truncated 결과는 대상 부재의 증거가 아니다.
- 이동·분할 뒤 ID, 효과 삽입·삭제 뒤 index, 편집 뒤 페이지 cursor를 갱신한다. prepare_*는 편집을 실행하지 않는다.
- 같은 효과의 여러 값은 한 parameters 배열을 쓴다. 기존 키가 있으면 keyframe 도구를 쓴다.
- native 쓰기는 직렬 실행한다. effect/track job을 한 번 제출하고 event를 기다린 뒤 cached terminal receipt를 읽는다. 실행 중 별도 호스트 조회·편집을 겹치지 않는다.
- job은 전체 원자적 rollback이 아니다. 취소는 단계 경계에서 멈추고 이미 완료한 편집은 남는다.
- effect job의 최종 보존 검사는 native 키 시간·값·보간·native tangent·효과 순서·클립 경계를 비교한다. query가 덧붙인 sequenceTime/clipTime/timeBasis는 native time의 설명 필드로 정규화하지만 sampledAt/value·readStatus는 유지한다. 개별 단계가 모두 PASS여도 최종 UNVERIFIED 영수증을 지우거나 재실행하지 않는다. 별도 현재 상태 검증은 원래 영수증과 구분한다.

## 시간·값
- 순서는 zero-based track index이며 V1=video 0, A2=audio 1이다.
- 타임라인은 시작 포함·끝 제외 [start,end)다. 정확한 ticks와 프레임 격자를 사용한다.
- place_clips의 expectedDurationSeconds는 소스 길이이며 시퀀스 프레임 단위로 내림한 정확한 길이를 검증한다. after.placementTiming의 예측 ticks와 실제 끝을 비교하고 추가 1프레임 오차를 허용하지 않는다. 소리의 끝부분 보존은 별도 청취 근거가 필요하다.
- 원본 전체 + 인·아웃은 보존할 결과의 기본값이다. 실행 경로는 먼저 get_agent_context.placementCapabilities를 확인한다. sourceRange.status:"pass"(영상은 videoStatus도 pass)인 경우에만 place_clips.sourceRange를 선택한다. 이전 서버에 이 필드가 없으면 get_capabilities.write.sourceRangePlacement:true를 직접 확인한다. panelVersion·tools/list·스킬 설치는 해당 패널의 기능 증명이 아니다. 한 원본·기존 트랙·빈 구간 overwrite, 정확한 source in/out·시작 및 소스 마크 복원을 검증한다. 길이와 timeline 시작은 정확한 sequence frame, source in/out은 파일 상대시간이다. legacy expectedDurationSeconds/expectedSourceInSeconds와 섞지 않는다. [실행 계약·지원 한계](source-editability-20261018.md)를 따른다.
- sourceRange가 미지원이어도 원본 보존 규칙은 유지한다. sequenceEditor와 exactClipTrim이 지원되고 원본 전체가 잠시 놓일 **전체 범위**가 모든 삽입 스트림에서 비어 있을 때만 원본 배치→fresh guard→trim_clip_exact를 선택할 수 있다. 최종 컷 구간만 비어 있는 것은 충분하지 않다. source in에 따른 임시 시작 위치와 coupled trim을 계산하고 영상/음성·링크 한계를 확인한다. 입증할 수 없으면 승인된 scratch 또는 수동 원본 편집으로 전환한다. discovery는 대안을 실행하지 않으며, 쓰기 시점에도 capability·대상·범위를 다시 검사한다.
- sequence time, native source time, 클립 상대시간을 구분한다. 역재생·속도 램프는 단순 배속식 대신 전용 SDK 증명을 사용한다.
- 파라미터 index/name/type/unit은 관측된 descriptor에서 얻는다. Point/Color의 읽기 표현을 쓰기 타입으로 추측하지 않는다.
- 애니메이션이 켜져 있고 키가 0개인 base-value 수정만 preserveEmptyAnimation:true를 사용할 수 있다.

## 화면·검증
- 일반 상태·목록·선택 검증은 마지막 위치를 유지한다. 지정 대상 조회와 편집은 대상을 따라간다. 시간 미지정의 같은 클립 작업은 현재 in-clip 시각을 유지한다.
- 마무리 focus 복원이나 restorePlayhead:true는 사용자 요청이 있을 때만 한다.
- 일반 follow는 best effort이며 visibility/workTarget 결과를 콘텐츠 결과와 구분한다. 명시적 펼침·포커스·도구 활성화와 특수 native 시간/색/Point/Speed의 증명은 각 기능 계약을 유지한다.
- 성공 boolean·접수·이벤트를 콘텐츠 성공으로 보고하지 않는다. 값·구조·보존은 호스트/아티팩트 증거로, 구도는 프레임으로, 소리 품질은 실제 음성 근거로 확인한다.
- **배치 뒤 각 클립의 남은 여유를 읽어 보고, 0이면 이유를 말한다.** place_clips/trim_clip_exact의 editability.handles와 warnings를 읽는다. null은 미확인이다. 파일 여유는 hard subclip·retime·링크 관계에서 실제 확장 가능하다는 증명이 아니므로 extensionVerified:false를 지운 채 보고하지 않는다.
- sourceRange 영상 배치의 최종 PASS는 사전에 독립 검수한 기대 합성 프레임의 SHA-256과 renderChecks의 실제 capture_program_frame이 일치해야 한다. 새 결과에서 얻은 해시를 그 결과의 기준으로 사용하지 않는다. 기준 없음은 dispatch 전 fail, 배치 뒤 검은 화면/해시 차이/캡처 실패는 UNVERIFIED이며 기존 쓰기 잠금·재실행 금지를 유지한다. 해시 PASS는 표본 합성 프레임에만 해당하며, 가려진 클립·표본 사이·음성은 별도 검증한다.
- 영수증으로 이미 입증한 항목을 목적 없이 재조회하지 않는다.

## 복구·동시 작업
- operationId는 새 의도 하나의 식별자다. 같은 ID/입력은 저장 영수증을 돌려주며 다른 입력은 충돌한다.
- contentDispatched:false인 사전 거절과 쓰기 이후 실패를 구별한다. dispatch 뒤 timeout은 UNVERIFIED다.
- 활성 작업은 기다린다. 종료된 정확한 root operation은 archive_inactive_operation으로 보관하고 leaseReleased:true를 확인할 수 있다. 원래 영수증과 현재 사용자 내용은 유지된다.
- archive는 이전 편집 성공이나 같은 편집 재실행 허가를 뜻하지 않는다. 수정 요청 전 현재 영향을 확인한다. 과거 결과 자체의 판정이 필요할 때 reconcile_mutation을 사용한다.
- 새 UUID blind replay, 수동 lease 삭제, 사용자 작업 덮어쓰기, 미완료 job 재시작을 하지 않는다.
- 알려진 장애는 create_subclip 생성 항목 없음(F, 원인 UNVERIFIED), split/ripple의 인점 있는 뒷조각 검은 렌더(A1, clone/lift 수정의 라이브 UNVERIFIED), 서브클립 효과 시간 대응의 SDK_CLIP_IDENTITY_AMBIGUOUS다. 우회 순서는 지원 확인된 원본 sourceRange → 전체 임시 배치 범위가 비었음을 입증한 원본 배치+정확한 trim·프레임/음성 검증 → 원본을 쓰는 수동 편집이다. 임시 범위를 입증할 수 없으면 승인된 scratch에서 준비한다. subclip이나 컷 길이 파일로 자동 우회하지 않는다. 편집 가능성을 줄이는 우회는 사용자에게 손실을 설명하고 명시적 선택을 받는다. SDK identity guard를 무시하거나 시간 오프셋을 추측하지 않는다.

## 파일·기능·권한
- 명시된 절대 미디어 경로는 로컬/NAS에서 읽기 전용으로 사용한다. 원본 쓰기, 상대경로, 미지원 확장자, 링크 탈출을 허용하지 않는다.
- 생성물은 허용된 artifacts/output·proxies·scratch에 둔다. 사용자 승인 범위의 기존 로컬 프로젝트 저장은 해당 프로젝트 경로를 따른다.
- inspect/edit/delivery는 도구 노출 설정이다. 사용자 작업 승인과 별개이며, inspect에도 화면 이동·PNG 생성·특수 native 증거용 저장이 있을 수 있다.
- 공개 UXP → 실제 선언된 Adobe IPC → 기능별 제한 native bridge 순으로 기존 Premiere 기능을 사용한다. 임의 CEP/QE/스크립트/합성 입력을 추가하지 않는다.
- 설치 스킬은 설치·관리자 권한·보안 설정 변경 권한을 부여하지 않는다. 기존 요청이 승인한 작업은 불필요하게 재승인받지 않는다.
- Computer Use는 실제 UI 작업에만 짧게 사용한다. 작업 소유 연결·참조를 공식 수단으로 정리하며 reset을 OS 프로세스 종료로 보고하지 않는다.

## 기능별 실행
[운영 스킬](../skills/USER-video-edit-premiere/SKILL.md), [도구 선택](tool-catalog.md),
[설치](installation.md), [지원 상태](release-status.md), [복구](operator-runbook.md)를 필요한 때 읽는다.
