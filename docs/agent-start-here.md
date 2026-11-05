# 새 에이전트 시작 가이드
[현재 운영 계약](agent-contract.md)과 [지원 상태](release-status.md)가 정본이다. 연결된 MCP의 tools/list가 실제 인자·프로필을 결정한다. 과거 작업 IDs·작품 설정·live 증거는 예제 입력이 아니다.

1. 연결된 MCP를 재사용한다. 첫 대상 조회는 get_agent_context다.
   연속 명령은 하나의 MCP stdio 연결에서 순서대로 호출한다. 명령마다 Node/클라이언트를 새로 띄우면 연결 초기화 비용이 반복된다. 공유 owner 재사용과 클라이언트 연결 재사용은 별개다.
2. premiere_ping에서 실제 panelVersion, panelMode:"agent", panelEntrypointId:"premiereUxpMcpPanel", deployment root를 확인한다. 서버 패키지 버전과 패널 버전은 별개다.
   원본 구간 배치는 get_agent_context.placementCapabilities를 먼저 본다. sourceRange.status:"pass"는 live capability가 지원을 광고한다는 뜻이며 실제 편집 PASS는 아니다. 이 필드가 없는 이전 서버는 get_capabilities.write의 sourceRangePlacement:true를 직접 확인한다. panelVersion이나 tools/list에 sourceRange 인자가 있다는 사실만으로 지원을 추정하지 않는다.
3. 첫 편집 전 get_mutation_recovery를 읽는다. 활성 job은 기다리고 불확실 작업은 [복구](operator-runbook.md)를 따른다.
4. context.status:"ready", editBoundary.allowed:true와 요청 대상 일치를 확인한다. 후속 조회·편집은 현재 project/sequence IDs로 고정한다.
5. [운영 스킬](../skills/USER-video-edit-premiere/SKILL.md)에서 필요한 기능의 reference만 읽는다. 원본 타이밍·사운드·편집 가능성을 보존하고 가장 작은 지원 명령을 사용한다.
6. 요청 결과를 host readback과 필요한 프레임/음성/UI 근거로 확인한다. 일반 검증은 마지막 작업 위치를 유지한다.

## 연결이 없을 때
[설치](installation.md)를 따른다. 이미 빌드된 설치를 매번 다시 빌드하지 않는다.
```json
{"command":"<absolute-node-executable>","args":["<absolute-installation>/apps/mcp-server/dist/index.js"],"cwd":"<absolute-installation>","env":{"PREMIERE_MCP_PROFILE":"inspect,edit,delivery"}}
```
inspect는 기본, edit는 편집, delivery는 공개 저장/닫기/열기/내보내기다. 프로필 변경은 해당 MCP 재연결이다.
owner runtime은 공유하고 UXP 기본 연결 포트는 8099다. 내부 control port는 동적으로 발견하며 하드코딩하지 않는다.
서버 지침은 연결 시 전달되고 상세 안내는 resources/list의 premiere://guide/*로 읽을 수 있다.

## 작업 선택
| 작업 | 우선 경로 |
|---|---|
| 클립·소스 발견 | query_timeline/query_media 필터·페이지 |
| 원본 구간 배치 | placementCapabilities 확인 → 지원된 sourceRange 또는 조건을 검증한 원본 전체 배치+trim_clip_exact |
| 한 파라미터 | get_effect_values(detail:"parameter") |
| 정확한 클립 편집 | prepare_clip_edit의 tool/arguments |
| 가로→세로 | 원본 source 유지 → Motion; fill 도구의 조건 확인 |
| 반복 효과·트랙 이동 | bounded job → event 대기 → cached terminal receipt |
| 합성 프레임 | capture_program_frame |
| 설치·실행 장애 | USER-premiere-connect-recover |

[스킬 설치·동기화](../skills/README.md) · [스키마 검증 예제](examples/agent-calls.json)
