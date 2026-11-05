# 원본 구간 배치와 편집 여유 — 2026-10-18

구현·오프라인 검증과 실제 Premiere 검증을 구분한다. 이번 변경은 저장소 소스만 수정하며 UXP 배포·Reload·라이브 편집은 하지 않는다. 새 경로, A1 렌더, F subclip, SDK 효과 시간 대응은 **라이브 UNVERIFIED**다.

## 기본 규칙

**배치는 원본 전체 파일 + 인·아웃이 기본이다. 컷 길이로 미리 자른 파일을 놓지 않는다.** 예외는 사용자가 원할 때만이며, 그때도 앞뒤 1초 이상 여유를 남기고 원본 경로·원본 구간과 파생본 좌표의 대응을 기록한다. 원본 시작/끝 때문에 여유를 확보하지 못하면 부족량과 이유를 먼저 설명하고 범위를 합의한다. 도구를 통과시키기 위한 사전 절단은 이 예외에 해당하지 않는다.

## place_clips.sourceRange

### 실행 전 지원 탐지 (2026-11-03 보완)

원본 전체 + 인·아웃은 기본 보존 조건이다. 구체적인 실행 경로는 **live capability**로 고른다. `get_agent_context.placementCapabilities.sourceRange.status`는 pass/unsupported/unverified를 반환한다. pass는 지원 광고이며 실제 편집 성공이 아니다. 영상에는 videoStatus:pass와 기준 renderChecks가 추가로 필요하다. 서버가 이전 버전이라 이 필드가 없으면 `get_capabilities.write`의 `name:"sourceRangePlacement",supported:true`를 직접 확인한다. panelVersion이 같아도 빌드/배포 시점은 다를 수 있고, tools/list에 인자가 존재해도 연결된 패널은 그 인자를 지원하지 않을 수 있다.

서버에서 context→capability를 직렬로 읽어 안내하므로 이 discovery 수정은 예전 패널과도 동작한다. 별도 polling·프로젝트 scan·콘텐츠 쓰기·자동 배포는 없다. capability 조회 실패는 context의 기존 대상 정보와 함께 UNVERIFIED로 표시하고 지원/미지원으로 단정하지 않는다. 매 discovery와 실제 dispatch에서 다시 읽으며 버전으로 캐시하지 않는다.

sourceRange가 미지원인 패널에서는 sequenceEditor·exactClipTrim 지원과 전체 임시 배치 범위의 빈 공간을 입증한 경우에 한해 원본 전체→fresh guards→trim_clip_exact를 선택한다. 모든 삽입 스트림의 전체 원본 길이가 들어갈 범위를 검사하고 overwrite/requireEmpty/expectedDurationSeconds/expectedMediaTypes를 쓴다. head trim이 timeline start도 옮기는 만큼 임시 시작을 계산한다. 최종 컷만 비어 있거나 임시 시작이 음수이면 이 대안은 사용할 수 없다. scratch/수동 원본 편집으로 넘기며 컷 길이 파일을 만들지 않는다. discovery에 나오는 대안은 자동 실행이나 새 승인 요구가 아니다. 기존 사용자 편집 범위 안에서 조건을 입증해 선택한다.

sourceRange 미지원의 사전 거절은 정상 안전 동작이다. 제작 중에는 배포·Reload로 이 거절을 없애려 하지 않는다. 추후 서버 변경 적용과 UXP sourceRange 배포는 서로 다른 작업이며, 사용자가 승인한 작업 종료 후 적용 범위와 live 검증을 따로 확인한다.

원본 전체 ProjectItem을 사용한다. subclip 생성, 미디어 변환, 원본 파일 수정, 새 트랙 생성은 하지 않는다. 한 호출에는 한 placement만 허용한다. `expectedProjectId`, `expectedSequenceId`, `expectedSequenceName`, `mode:"overwrite"`, `requireEmpty:true`, `expectedMediaTypes` 및 기존 V/A 트랙 인덱스가 필요하다. 예상하지 않은 스트림이 같은 트랙을 덮지 않도록 두 목적 트랙의 구간을 모두 검사한다. 영상/오디오의 독립 Source Monitor 마크를 현재 공통 setter로 정확히 복원할 수 없으면 dispatch 전에 거절한다.

| 필드/결과 | 의미 |
|---|---|
| placements[0].sourceRange.inPointSeconds/outPointSeconds | 원본 파일 상대 [in,out). media timecode/sequence time과 구분 |
| placements[0].timeSeconds | 타임라인 시작. 시작과 source 구간 길이는 정확한 sequence frame; source in 자체는 sequence grid로 반올림하지 않음 |
| expectedDurationSeconds/expectedSourceInSeconds | 기존 배치 전용 기대값. sourceRange와 함께 지정하면 사전 거절. 기존 길이의 frame floor 계약 유지 |
| renderChecks | 영상은 필수. 1–10개 `{timeSeconds,expectedSha256}`. 각 시각은 배치 구간 내부, SHA-256은 독립 검수된 기대 합성 PNG의 값 |
| sourceMapping | 선택 기록 `{originalPath,originalStartSeconds,originalEndSeconds,originalDurationSeconds?}`. 절대경로, 원본 구간 대응. 읽기/쓰기·relink 권한이 아니며 caller_recorded_not_verified |
| hostResult.placement | 내부 구조 검증 영수증. sourceRangeProtocol:1·sourceMarksRestored·시작/in/out·원본 ID·stream·native 순서·무관 항목 보존 |
| hostResult.editability | 각 배치 클립의 sourcePath, handles, derivative, warnings |
| hostResult.renderVerification | 실제 capture_program_frame PNG와 기준 SHA-256 비교. scope는 sampled_composited_frames_only |
| hostResult.audioVerification | 오디오가 있으면 unverified. 청취 또는 실제 export 음성 비교를 별도로 요구 |

실행은 source mark 지정 → readback → 원본 ProjectItem의 SequenceEditor overwrite → source mark 복원·readback → 타임라인 readback → 프로그램 프레임 비교 → 마지막 대상 재조회 순서다. 각 거래 전에 wrapper를 재획득한다. setter와 배치는 서로 다른 transaction이며 이미 실행했는지 모르는 단계를 재호출하지 않는다. 소스 마크를 사용자가 바꿨거나 target/path가 달라졌으면 복원으로 덮지 않고 UNVERIFIED로 남긴다. 복원 증거는 읽힌 인·아웃 값이며 UI의 '마크 미지정' 표시 상태까지 증명하지 않는다.

MCP owner가 하나의 durable root lease 아래 `:place` 자식 영수증과 렌더 증거를 모은다. 내부 구조 PASS만 최종 결과로 돌려주지 않는다. 기준 프레임 없음·구버전 panel capability 없음은 dispatch 전 fail이다. 배치 후 렌더 불일치/캡처 실패·소스 마크 복원 실패는 UNVERIFIED이며 원래 재실행 금지·쓰기 잠금을 유지한다. 불확실 영수증을 고쳐 쓰거나 자동 archive하지 않는다.

### 기준 프레임을 준비하는 방법

승인된 scratch 프로젝트에서 원본 전체 파일의 대응 구간을 정상 표시한 기준 시퀀스를 준비한다. 필요한 효과·배경·해상도를 같은 상태로 맞추고, 대상 클립이 실제 보이는지 눈으로 먼저 확인한다. 대상이 위 트랙에 가려지거나 완전히 투명하면 해당 표본으로 그 클립의 렌더를 입증할 수 없다. 이런 경우 scratch의 격리된 기준 시퀀스에서 확인한다. 기준 capture_program_frame의 frame.sha256을 기록한 뒤 새 배치의 동일한 구도·소스 시각에 대응하는 timeline timeSeconds로 renderChecks를 작성한다. 새 배치에서 나온 해시를 기대값으로 복사하지 않는다.

비교는 PNG 파일 bytes의 SHA-256이다. 픽셀은 같아도 인코딩/metadata가 바뀌면 보수적으로 불일치할 수 있다. 평균 밝기나 '검지 않음'만으로 올바른 영상이라고 판단하지 않는다. 검은 장면을 의도한 원본은 검수된 검은 기준과 비교할 수 있다. 최소 한 표본은 요청 프로토콜의 하한이고, 실제 작업은 시작 직후·중간·끝 직전 등 위험 위치를 고른다. 표본 PASS는 전체 재생, 숨은 트랙, 실제 확장 가능성, 음성 품질의 PASS가 아니다.

## 핸들과 파생본 알림

계산은 `head=in`, `tail=Media.duration-out`의 정확한 ticks를 초로 바꾼다. media.start의 timecode offset을 더하지 않는다. 소스 길이는 public `getMedia().getDuration()` 또는 비동기 `duration` property에서 읽는다. 읽을 수 없거나 범위가 모순이면 두 값은 null이고 SOURCE_HANDLES_UNVERIFIED를 반환한다. 둘 다 정확히 0일 때 NO_SOURCE_HANDLES를 낸다. sub-frame 여유를 0으로 반올림하지 않는다.

sourceRange는 `hostResult.editability`, 기존 place_clips와 trim_clip_exact는 `after.editability`를 읽는다. **배치 뒤 각 클립의 남은 여유를 읽어 보고, 0이면 이유를 말한다.** 한쪽이 0인 경우에도 원본 시작/끝인지, 사전 절단인지 설명한다. hard subclip·retime·링크 제약까지 확인하지 않았으므로 `extensionVerified:false`다. 파일 이름의 `_편집용_<n>f`, `조각` 경로, `_f<시작>-<끝>` 또는 caller sourceMapping은 POSSIBLE_PRETRIMMED_SOURCE를 낸다. 이 경고 자체로 배치를 막지 않고 이름에서 원본 경로/오프셋을 추측해 쓰지 않는다. 기존 제작 기록을 자동 스캔하거나 파생 관계를 임의로 확정하지 않는다. mapping은 영수증에 남으며 ProjectItem metadata에 새로 쓰지 않는다.

## 알려진 실패와 우회

| 실패 | 판단과 우회 |
|---|---|
| F create_subclip — 생성 항목 없음 | 원인 UNVERIFIED. bool로 생성 성공을 주장하지 않는다. 지원 광고를 확인한 원본 sourceRange를 우선 |
| A1 split/ripple — 인점 있는 뒷조각 검은 화면 | native 순서·clone/lift 등록 수정은 오프라인 검증, 실제 렌더/음성 UNVERIFIED. 새 경로도 별도 실제 렌더 검증 필요 |
| SDK_CLIP_IDENTITY_AMBIGUOUS — 중간 source subclip 효과 시간 대응 | 이번 변경의 수정 대상 아님. 정확한 SDK correlation을 유지. fresh 대상도 모호하면 효과 쓰기를 중단하고 수동 편집으로 넘김 |

권장 순서는 지원 확인된 원본 sourceRange → 전체 임시 범위 조건을 입증한 원본 배치+trim_clip_exact 및 프레임/음성 검증 → 원본을 쓰는 수동 편집이다. 실행 여부가 불확실한 원래 요청을 다시 제출하지 않는다. 현재 타임라인에서 전체 임시 범위를 입증할 수 없으면 승인된 scratch에서 원본 배치 후 trim을 준비한다. 어떤 우회든 여유·효과·링크를 줄이면 사용자에게 구체적인 손실을 알린다.

## 기존 파생본을 원본으로 교체할 수 있는가

현재 MCP 계약에서 **타임라인 위치·길이·링크·효과·키를 전부 보존하는 자동 교체는 UNSUPPORTED**다. 공개 `ClipProjectItem.changeMediaFilePath`는 ProjectItem 전체에 영향을 주고 undoable하지 않으며, 잘린 파일의 0초와 원본의 중간 시각을 대응시키는 per-instance offset 기능이 아니다. `attachProxy`도 이 시간 대응 문제를 해결하지 않는다. 실제 링크 관계 getter도 미지원이다. remove/place나 clone으로 교체하는 것은 효과/키/source time/연결의 보존 증명이 없다. 일반 CEP/QE나 프로젝트 XML 패치를 새 우회로 추가하지 않는다.

수동 대안은 사용자가 승인한 복사본에서 기존 클립을 보존한 채 원본을 import하고, 정확한 원본 구간을 별도 빈 트랙에 놓는 것이다. 파생본 구간의 원본 offset을 기록에서 검증하고 같은 timeline 시작/길이로 맞춘다. 효과·키프레임은 clip-relative/sequence/source time을 구분해 필요한 것만 옮긴다. 화면·오디오·gain·속도·전환·A/V link와 앞뒤 확장을 직접 검사한다. 검증과 사용자 확인 후 기존 파생 항목의 교체 범위를 확정한다. 전체 project relink는 같은 소스의 모든 사용처를 조사하기 전 실행하지 않는다. 이번 작업에서 이 수동 작업도 실행하지 않았다.

API 근거: 저장소에 잠긴 `@adobe/premierepro` 타입의 ClipProjectItem/Media/SequenceEditor 및 [Adobe ClipProjectItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem), [Media](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/media), [SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor). API 선언은 live 정상 동작 증명이 아니다.

저장소 개발용 라이브 절차는 `docs/production-errors-20261016-live-plan.md`의 원본 구간 시험에 있다. 이 개발 기록은 설치 번들의 운영 권한을 늘리지 않는다.
