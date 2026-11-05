# 배포 기능 상태
이 표는 배포 소스의 요구 조건이다. 현재 연결된 설치의 성공을 선언하지 않는다. live 상태는 premiere_ping/get_capabilities와 기능별 응답을 확인한다.

| 기능군 | 의존성·지원 경계 | 증거 상태 |
|---|---|---|
| 지침·스킬·MCP resources | 배포 소스 0.3.18, MCP 서버 0.2.16, 운영 계약 1.0.0, 스킬 bundle 1.0.12 | 정적·프로토콜 검증 대상; 라이브 편집과 별도 |
| 설치·클라이언트 등록 | Setup에서 Codex/Claude Code/Gemini(Antigravity) 선택(선택지를 한 줄씩 보여 주고, 쓰기 전에 이 사용자의 설정·스킬 경로를 출력), 기존 설정 병합·백업, 스킬 4개 설치, Connect의 정확한 설치 경로·버전 검증 | 격리 설정/빌드 검증; Gemini 병합·충돌·백업은 fixture 검증. Adobe 실제 설치와 다른 PC 검증은 별도 |
| 배포 식별자 | UXP `ai.brahma.yantra.pr-uxp-mcp`, panel 0.16.10, 보조 플러그인 `ai.brahma.yantra.*` | 기존 ID와 별도 플러그인. 이전 설치 감지·전환 안내를 따라 중복 로드 방지 |
| 정확한 틱 쓰기 | 모든 native 시간은 가장 가까운 틱 문자열로 만들고 값 보존을 확인한다(`TickTime.createWithSeconds` 미사용). trim_clip_exact·move_clips는 프레임 격자 틱으로 쓰고 PASS에 정확한 틱 readback을 요구하며 되돌리기는 원래 틱을 복원한다. 음수 이동은 문자열 factory, 안 되면 `TIME_ZERO.subtract`로 만들고 전송 전에 증명 | 회귀검사·소스 계약 검사 PASS(가짜 Premiere: 1.001초가 1틱 부족해지는 내림 재현 포함). 실제 Premiere 반영·live readback은 UNVERIFIED |
| 따라가기 실패와 영수증 | 자동 따라가기 실패 `{status:'unverified',phase,reason}`를 workTarget 계약에 포함하고 reason에서 "content command was not dispatched"를 제거한다. 계약에 맞지 않는 영수증도 버리지 않고 UNVERIFIED(전송 전이면 FAIL)로 저장해 archive/reconcile이 가능하다 | 회귀검사 PASS. 2026-11-04 clone 사례의 원인 요청은 트랙 타기팅 CEP helper의 loopback fetch였다. helper 연결 실패 자체의 원인은 UNVERIFIED |
| MOGRT 뒤에 추가 | insert_mogrt_caption의 명시적 trailing_append, exact count/hash/target/frame과 전체 빈 suffix·전환 없음·트랙 상태 검증 | Premiere26.5.2/호환후보0.15.17에서 두 인접 프레임의 기존 방식 대비 전체42파라미터·source bounds·트랙·원래 시퀀스 보존 PASS. 네 PNG의 독립 SHA도 동일. 다른 템플릿·중간 빈 구간의 지원을 뜻하지 않음 |
| 대량 그래픽·오디오 복제 | 동일 source 트랙의 additive overwrite를 매 항목 fresh 원본·action1개 transaction으로 처리. 매 단계 전체 원본·누적 신규·트랙·전환·설정 readback, 첫 실패에서 중단하며 재전송 없음 | 관련83개 회귀검사 PASS. 호환패널0.15.19/Premiere26.5.2에서 그래픽107복제·오디오96클립 배치의 내용·보존·저장 PASS. 전체 단계는 각각32.108초/29.979초로 기준 대비1.29배/1.19배, 5배 목표 미달. 이전 compound의 부분 적용과 오디오 종료 때문에 해당 최적화를 제거했으며 과거18배·5.41배를 현재 성능으로 사용하지 않음. native 원인과 모든 환경의 무충돌은 미확정 |
| 복제 완료 대기 | clone_clips의1..100개 입력에15초+개수×1초를 최소 대기시간으로 적용하고 기존 더 긴 설정은 유지. 이 변경은 MCP stdio 연결을 새로 시작해야 적용됨 | 관련36개 회귀검사 PASS. 51개 복제의 host PASS가15.274초에 끝나 기존15초 제한을 넘은 실기에서 도출. timeout 후 원래 UNVERIFIED 영수증은 불변이며 자동 재전송하지 않음 |
| UXP 해제·재연결 | 최종 destroy에서 WebSocket listener·타이머를 동기 정리하고 close를 한 번 요청. 종료 중 새 observer·timer·Promise를 추가하지 않음. callback_release와 실제 transport 종료를 구분 | 관련33개 회귀검사·타입·lint PASS. 호환패널0.15.21/Premiere26.5.2에서 idle Unload/Load, 동일 프로세스 생존, callback_release 로그와 canonical 재연결 PASS. 이전 async 후보의 완료 콜백은 실기에서 관측되지 않아 제거. 이전 native Unload 충돌의 근본 원인과 모든 환경의 무충돌은 UNVERIFIED |
| 네이티브 그래픽 객체 수명 | 변경 뒤 250ms 안정화 대기, 100ms 간격의 동일 구조 확인, 비동기 값 조회마다 객체 재확보. 적용 도중 예외는 재전송 없이 값·애니메이션·다른 파라미터 보존으로 판정 | 호환패널0.15.21에서 새 MOGRT30개·복제60회·혼합 효과60단계·전체 보존·저장 PASS, 효과 실행115.347초. 실제 글자·플레어·모션110.0과 타임라인을 관찰하고 정상 닫기/no_project 확인. 해당 시나리오의 증거이며 Adobe 내부 원인과 모든 환경의 무충돌은 미검증 |
| 오디오 객체 수명·효과 결과 판정 | 오디오 복제·효과 변경·화면 따라가기 뒤 250ms 안정화와 fresh 객체 조회. Properties 변경 뒤 새 객체로 readback. 같은 대상의 내부 호출은 숫자 위치 힌트만 공유하고 실제 메타데이터·값·애니메이션은 다시 읽음 | 호환패널0.15.19에서120클립·360단계·240회 follow·96회 연속전환·24회 저장 PASS. 독립 비교에서 최종 값·애니메이션 SHA와 원본 보존 일치. 1433.928초로 기준2964.416초 대비2.067배, 5배 목표 미달. 연결 해제/실패를 값 검증 PASS로 표시하지 않으며 Adobe 내부 원인과 모든 환경의 무충돌은 미검증 |
| 좁은 조회·공동 편집·마지막 위치 | 기존 UXP 계약; 패널 0.15.0 이상을 이 안내의 기준으로 사용 | Windows 과거 live 기록 있음; 현재 설치 재확인 |
| 공통 명령 비용 | clone/remove/MOGRT는 호스트 자체 사전 검사·readback을 유지하며 사용되지 않는 전체 프로젝트 계획 조회 생략. 새 runtime은 인증 대기를 단일 요청 안에서 처리하며 이전 owner와도 호환 | 과거 정상 UI 묶음의 2.61배 개선은 당시 조건의 결과다. 현재 네이티브 그래픽은 안정 대기와 재확보 비용이 추가됐다. 호환 설치의 60단계 혼합 배치 약 200초; 환경·구성별 성능 보장 없음 |
| PNG 검토 프레임 | 허용된 출력 폴더를 export 전에 생성. 폴더 준비 실패는 미전송 FAIL, 전송 후 timeout은 UNVERIFIED | 새 폴더 실제 내보내기와 부분 실패·lease 회귀 검증. 기존 폴더에서도 발생하는 다른 native timeout 원인은 별도 |
| 프로젝트·미디어·기본 클립 편집 | Premiere 26.3+ public API, 각 도구의 preconditions | 작업별 live readback 필요 |
| 프로젝트 닫기 | exact active path/ID·project view inventory, CLOSED event와 view 부재를 함께 검증 | 호환 설치0.15.13에서 새 사본3회 PASS. pending native 호출은 timeout으로 lane을 풀지 않음. Adobe 내부 crash 원인 제거는 미검증 |
| 빈 트랙 삭제 | 기본 archive 경로의 저장→검증된 닫기→수정→재열기→저장. 공유 참조·파일SHA drift 거절 | Premiere26.5.2/호환패널0.15.14 새 사본 V6→V4, A4/C1·225항목, 생존 AV·노출 효과값/키·전환·자막 payload 보존 PASS. 전체 opaque graphic 원문/픽셀은 별도. 명시적 native 경로는26.3 제한을 유지 |
| 원본 구간 배치·편집 여유 | 실제 write.sourceRangePlacement:true 필요; 영상은 programMonitorFrame 및 독립 렌더 기준 필요. get_agent_context.placementCapabilities에서 먼저 확인 | 소스·오프라인 회귀 PASS; 실제 설치와 렌더·음성·확장 UNVERIFIED. 패널 버전만으로 지원 판정 불가 |
| 트랙 잠금 | source panel 0.15.1 + 별도 ai.brahma.yantra.track-lock helper | 소스/회귀 준비; 이 개발 기록에서 설치·live lock 변경 UNVERIFIED |
| targeting·Project 선택·intrinsic disclosure·SRT | 기능별 CEP helper; Windows Setup 설치 대상 | 설치 manifest와 live heartbeat 별도 확인 |
| native focus·scroll·caption font | Windows 기능별 C# adapter | 현재 환경·정확 대상 native proof 필요 |
| video 시간·Color/Point·native tool·mask tracking | 별도 Adobe SDK 플러그인, 일부 Premiere 26.5 대상 | 범용 후보와 설치기 준비. Adobe wrapper 재배포 근거 미확인으로 공개 바이너리 제외; 실제 설치/실행 없으면 해당 기능 미지원 |
| macOS | 공통 UXP·설치 경로 실험적, track-lock 설치 경로 포함 | 실기기 UNVERIFIED; Windows native parity 없음 |
| proxy·미디어 분석·검사 | 별도 FFmpeg/ffprobe | 도구/코덱 설치와 실제 산출물 확인 |
| SRT 새 트랙 가져오기 | exact frameTicks를 제공하는 패널·고정 SRT helper, 입력 SRT는 그대로 전달 | 예상 큐 시각과 UXP readback 비교. 불일치는 생성된 트랙을 남긴 UNVERIFIED이며 자동 재가져오기/1프레임 보정 없음 |
| 기존 caption 큐별 글꼴·크기·RGB | edit_existing_sequence_structure의 captionStyle.items, 정확한 트랙·큐 index/ticks, 지원되는 단일 style run archive | 프로젝트 저장·닫기·다시 열기가 필요. 미선택 큐·template·문구·시각 보존과 archive/UXP 검증. ProjectItem 없는 그래픽은 고유 위치·이름·component 체인으로 AV 구조 보존을 검증하며 opaque 그래픽 원문/렌더는 미검증. 실제 설치 글꼴·색 픽셀은 프레임으로 별도 확인 |
| 기존 caption 문구·native Object Mask 생성 | 응답별 현재 지원 한계 | 문구 preview/활성화를 완료로 보고하지 않음 |
| 외부 segmentation | 명시적으로 선택한 서비스/model | 실제 가용성과 single-frame/videoTracking capability 확인 |

서버 package, UXP panel, helper, skill/contract는 서로 다른 버전이다. source/built/installed/loaded/live proof를 구분한다. 과거 특정 작품·운영체제의 성공을 새 설치의 보증으로 복사하지 않는다.

원본 코드·문서는 0BSD로 제공하며 크레딧은 선택이다. Adobe 제품과 외부 의존성에는 각각의 조건이 적용된다. SDK 후보의 구성·설치·재배포 경계는 [native add-ons](native-addons.md), AI 설치의 시작점은 [AI_INSTALL.md](../AI_INSTALL.md)를 따른다. GitHub 공개와 다른 사람 PC 설치는 이 소스 준비 작업에 포함하지 않았다.
