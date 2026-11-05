# 타임라인·트랙

prepare_clip_edit로 현재 split/move/trim/lift 인자를 얻고 실제 도구를 별도로 실행한다. 실행 시 guard는 다시 검증된다.

## 원본 구간 배치

원본 전체 파일 + 인·아웃은 **결과 보존의 기본값**이며 모든 패널이 sourceRange를 지원한다는 뜻은 아니다. 먼저 get_agent_context.placementCapabilities.sourceRange.status를 확인한다. pass는 지원 광고, unsupported는 미지원, unverified는 조회 실패/모호함이다. 영상은 videoStatus도 pass여야 한다. 이전 서버에 필드가 없으면 get_capabilities.write에서 name:"sourceRangePlacement", supported:true를 직접 확인한다. 서버 tools/list나 panelVersion만으로 실행 경로를 정하지 않는다. dispatch 시의 재검사는 그대로 적용된다.

sourceRange 미지원이며 sequenceEditor·exactClipTrim은 지원된다면, 사용자 편집 요청 범위에서 원본 전체 배치→fresh ID/guard→trim_clip_exact를 선택할 수 있다. 임시 전체 길이가 **모든 삽입 스트림에서** 비어 있어야 하며 최종 컷만 비어 있어서는 안 된다. overwrite·requireEmpty·전체 expectedDurationSeconds·expectedMediaTypes를 사용한다. source in을 올리는 head trim은 timeline 시작도 움직이므로 요청 최종 위치에서 source in 변화량을 뺀 임시 시작을 계산한다. 음수 시작·임시 충돌·정확한 범위/링크 증명 불가 시 scratch/수동 원본 편집으로 넘긴다. 대안은 자동 실행하지 않고 불확실한 이전 요청을 재전송하지 않는다. 컷 길이 파생본으로 바꾸거나 제작 중 배포/Reload하지 않는다.

지원 확인 후 원본 전체 파일을 import하고 `place_clips.placements[0].sourceRange:{inPointSeconds,outPointSeconds}`를 쓴다. 한 요청에 원본 하나, 정확한 project/sequence/name, 기존 video/audio track index, `mode:"overwrite"`, `requireEmpty:true`, `expectedMediaTypes`가 필요하다. 소스 상대 in/out의 차이와 timeline 시작은 정확한 sequence frame이어야 한다. legacy expectedDurationSeconds/expectedSourceInSeconds는 함께 보내지 않는다. 잠시 지정한 source marks는 원래 값으로 복원·검증된다. A/V mark가 서로 다르거나 읽을 수 없으면 dispatch 전 거절한다. full source를 놓고 위험한 범위를 덮어쓴 뒤 줄이는 경로가 아니다.

영상에는 `renderChecks:[{timeSeconds,expectedSha256}]`도 보낸다. SHA-256은 같은 해상도·효과·배경에서 **원본의 대응 구간이 실제 보이는 것으로 독립 검수된** capture_program_frame 기준 PNG에서 얻는다. 배치 결과 자체를 기준으로 삼지 않는다. 최소 한 표본, 시작 직후·중간·끝 직전의 여러 표본을 권장한다. 기준이 없으면 원본을 쓰는 수동/scratch 검증 경로를 선택한다. 기준 없는 영상 쓰기는 사전에 거절되며, 배치 뒤 해시 차이나 캡처 실패는 UNVERIFIED다. sampled 합성 프레임 통과는 가려진 항목·전체 재생·소리의 증명이 아니다.

sourceRange 영수증의 `hostResult.editability`, legacy 배치·정확한 trim의 `after.editability`에서 각 `handles.headSeconds/tailSeconds`와 warnings를 확인한다. 둘 다 0이면 NO_SOURCE_HANDLES, 기간/구간을 못 읽으면 null과 SOURCE_HANDLES_UNVERIFIED다. `extensionVerified:false`는 file duration만 측정했다는 뜻이며 hard subclip 제한을 없애지 않는다. `_편집용_<n>f`, `조각` 경로, `_f<시작>-<끝>` 이름 또는 선택적 `sourceMapping:{originalPath,originalStartSeconds,originalEndSeconds,originalDurationSeconds?}`는 파생본 경고 근거다. 기록은 자동으로 파일에서 추정하지 않으며 caller_recorded_not_verified로 반환한다.

## 알려진 실패와 우회 순서

1. `create_subclip` F: boolean 성공 뒤 새 항목이 없던 원인은 UNVERIFIED다. 기본 배치를 위해 subclip을 만들지 않는다.
2. A1: split/ripple의 인점 있는 뒷조각이 모델 값과 달리 검게 보였다. clone/lift 등록 경로는 오프라인 수정됐고 실제 렌더·음성은 라이브 UNVERIFIED다.
3. `SDK_CLIP_IDENTITY_AMBIGUOUS`: 원본 중간에서 시작하는 subclip의 효과 시간 대응이 실패할 수 있다. fresh identity를 읽고 모호하면 중단한다. native guard를 생략하거나 zero-in 파생본을 만들어 통과시키지 않는다.

우회는 지원 확인된 원본 sourceRange → 위의 전체 임시 범위 조건을 입증한 원본 배치+trim_clip_exact 및 프레임/음성 증명 → 승인된 scratch/수동 원본 편집 순서다. 사용자만 파생본 예외를 선택할 수 있고 그때도 앞뒤 1초 이상과 원본 대응을 남긴다. 부족한 여유나 효과·링크 보존 손실을 먼저 알린다. 기존 파생본의 자동 원본 교체 도구는 없다. project-wide relink나 삭제/재배치로 효과·키·링크까지 보존됐다고 주장하지 않는다.

## 기존 명령

- place_clips: 요청 source/트랙/시작·기대 길이·expectedMediaTypes·requireEmpty를 지정한다. timeline/source ticks와 실제 streams를 확인한다. 인접 구간은 tick 끝점으로 비교하며 epsilon을 빼서 통과시키지 않는다.
- expectedDurationSeconds는 소스 길이다. 영상·오디오 모두 시퀀스의 완전한 프레임 수로 내림한 정확한 길이를 검증하며 after.placementTiming에 예측 ticks를 남긴다. 예측보다 1프레임 짧은 결과도 UNVERIFIED다. WAV 끝 소리 보존은 실제 음성 근거로 별도 확인한다. Placed duration differs 뒤에는 실제 배치 상태부터 읽는다.
- trim_clip_exact: 정상 속도·정방향 단일 클립. start/end 수정은 대응 source in/out도 움직인다. retime/역재생/전환·충돌은 전용 지원 없으면 거부한다.
- split_clips: 모든 AV(숨김/비활성 포함)의 마지막 끝 뒤에 clone→trim하고, 잘린 범위에 뒷조각을 새로 등록·검증한 뒤 staging을 lift한다. native 트랙 순서·소스·효과를 검증한다. 구조 PASS만으로 프로그램 화면·오디오 재생까지 정상으로 보고하지 않는다. 실제 지원 없는 linked A/V 그룹을 몰래 분리하지 않는다. SPLIT_STAGING_RANGE_OCCUPIED면 숨김·비활성 클립을 포함해 모든 트랙을 다시 읽고 새 계획을 만든다. 숨긴 내용을 지우거나 dispatch된 split을 다시 보내지 않는다.
- move_clips/move_clip_to_track: 정확한 대상과 빈 범위·기존 트랙을 요구한다. 이동 후 ID, source/timeline, 효과·키와 무관 항목을 확인한다.
- remove_clips: non-ripple lift, 한 media type, 최대 20개. 전환 연결·mixed media·ripple 삭제는 다른 지원 경로가 필요하다. 자동 분할이 없으므로 20개를 넘는 요청은 묶음마다 PASS와 ID 갱신을 확인한 뒤 다음 묶음을 보낸다.
- clone_clips는 현재 시퀀스의 프레임 경계와 기존 트랙을 대상으로 한다. 같은 source track의 비중첩·빈 overwrite 목적지도 각 복제마다 원래 source의 fresh metadata를 확인하고 action 한 개의 동기 transaction으로 실행한다. 기존 안정화 대기 뒤 전체 기존 항목·트랙·자막·전환과 지금까지 추가된 모든 항목의 고유 identity·source ranges를 매 단계 readback한다. 여러 action을 한 transaction에 묶는 경로는 제거됐다. 그 밖의 지원 경로는 기존 순차 실행을 유지하며 dispatch 후 fallback/replay는 없다. insert는 ripple로 ID가 바뀌므로 한 호출에 한 개만 실행하고 다음 작업의 ID를 새로 조회한다. 일부 성공 뒤 중단되면 실제 상태를 확인하며 전체 묶음을 재전송하지 않는다. 구조 검증은 그래픽 픽셀·소리까지 증명하지 않는다.
- clone_clips의 유효한 1..100개 요청은 서버에서 최소 `15000 + 개수 × 1000`ms를 기다린다. 더 긴 기존 제한은 유지한다. 클라이언트의 MCP 호출 제한도 이를 수용해야 하며, 서버 업데이트는 MCP stdio 연결을 새로 시작해야 반영된다. 대기시간이 늘어도 timeout은 UNVERIFIED이고 자동 재전송하지 않는다.
- clone_clips→검증→원본 audio lift는 필요한 경우의 한정된 오디오 이동 우회다. 정확한 audio trackItemId에 `clones:[{trackItemId,timeOffsetSeconds:0,audioTrackOffset:목적지-현재 트랙}]`을 쓰고, 복제 오디오의 source/시간/효과와 영상 불변을 읽은 뒤에만 원본 오디오 ID를 `remove_clips`(ripple:false)로 지우고 다시 조회한다. 링크 관계까지 보존됐다고 보고하지 않는다.
- prepare_timeline_ripple→ripple_timeline은 원래 좌표의 {atSeconds,frames} 양의 frame 경계를 쓴다. AV와 caption 처리·저장된 caption text/style 보존이 포함되는 별도 흐름이다.
- track targeting, mute/disabled, lock은 별개다. 잠금은 read_track_locks→set_track_locks의 명시적 locked:true/false와 exact track ID/name, 필요 시 expectedLocked로 처리한다. 자동 unlock·caption lock은 지원하지 않는다.
- read_track_locks/set_track_locks는 패널 0.15.1 및 별도 track-lock helper가 필요하며 설치와 live support를 확인한다.
- 빈 트랙 삭제와 캡션 archive style 변경은 서로 다른 작업이다. inspect_sequence_structure로 현재 host와 저장본을 대조하고 edit_existing_sequence_structure에 정확한 index/ID/UID/name/count를 전달한다. trackRemovalRoute 기본은 archive이며 저장→검증된 닫기→파일 수정→재열기→저장과 보존 검증을 수행한다. 공유 group/track/audio inlet이나 저장SHA 변경은 거절한다. 생존 source·범위·노출 효과값/키·영상 전환·자막 payload를 검증하며 opaque graphic 원문/전체 렌더는 별도다. native는 명시적으로 선택한 버전 제한 경로이며 archive와 자동 전환하지 않는다. 실패·timeout은 receipt와 실제 상태를 확인하고 재실행하지 않는다.

시간은 [start,end), 마지막 키는 end보다 앞이다. 정확한 ticks를 쓰고 소수 6자리 반올림으로 경계를 보정하지 않는다. 삭제·분할·이동 뒤 오래된 clip ID나 cursor를 재사용하지 않는다.
