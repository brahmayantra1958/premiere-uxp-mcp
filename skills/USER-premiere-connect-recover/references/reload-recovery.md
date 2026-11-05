# 적용·복구 체크

업데이트가 반영되지 않음, 연결 오류, 누락 도구, UDT 창·Reload 문제에 읽는다. 상세 조치와 로그 위치는 [운영 런북](premiere://guide/operator-runbook), 설치 경로는 [설치 체크](setup.md)를 따른다. MCP가 없으면 확인된 설치 루트의 docs/operator-runbook.md를 읽는다.

## 한 번에 필요한 계층만 적용

| 바뀐 대상 | 적용 |
| --- | --- |
| stdio 도구·프로필·MCP instructions/resources | 해당 MCP 클라이언트 재연결 |
| 공유 owner 실행 코드·읽는 설정 | 활성 작업 종료 확인 → 자동 재시작할 클라이언트 연결 중지 → 같은 설정으로 공식 runtime-cli.js stop/start → 재연결·ready |
| UDT 패널 코드·재생성한 deployment-config.js | 등록 경로의 빌드 완료 후 해당 항목 Reload |
| UDT manifest·권한·entrypoint | 해당 항목 Unload → Load |
| CCX·CEP·SDK 설치/교체 | 해당 설치 문서와 필요한 정상 Premiere 재시작 |
| 개인 스킬·references | 전체 폴더 재설치 → 클라이언트 스킬 목록 갱신·새 대화 확인 |

owner의 Node는 Setup의 artifacts/install/node.json에 기록돼 있다. runtime-cli.js status로 발견한 owner를 재사용한다. 내부 control port를 고정하지 않는다. 클라이언트 재연결만으로 기존 owner 코드·설정이 갱신되지는 않는다. 원인이 다른 계층에 있으면 UXP Reload를 반복하지 않는다.

## Reload 전후

1. get_mutation_recovery와 관련 job 상태를 읽는다. active/queued는 기다리고, 끊긴 요청은 root ID·영수증을 보존한다. 연결 부재를 비활성 증거로 사용하지 않는다.
2. UDT에 등록한 절대 manifest 경로와 빌드 루트를 대조한다. 다른 checkout 빌드는 현재 패널을 바꾸지 않는다.
3. 코드만 바뀌면 한 번 Reload, manifest가 바뀌면 Unload → Load. 사용자 프로젝트 저장·닫기·Premiere 재시작을 단순 Reload의 전제에 추가하지 않는다.
4. 실제 ping으로 panelVersion·panelMode·localScratchRoot를 확인한다. scratch는 의도한 설치의 artifacts/scratch여야 한다. 버전이 같은 재빌드는 변경 경계의 readback도 확인한다.
5. fresh context와 recovery를 다시 읽고, 이전 미확인 편집을 새 ID로 재제출하지 않는다. 복구한 기능의 최소 확인을 마치고 마지막 작업 위치를 유지한다.

네이티브 UDT 버튼 조작이 제공되지 않으면 준비를 마친 뒤 사용자에게 정확한 항목의 한 번 조작을 요청하고 이유를 밝힌다. 사용자의 완료 응답 뒤에는 readback을 먼저 확인한다. 새 수정이나 적용 실패 증거 없이 같은 요청을 반복하지 않는다.

## 이번에 확인된 오류 패턴

- UDT 창이 사라짐: 프로세스·창 핸들·시작 시각·충돌 로그를 비교한다. UDT 2.3.0의 기존 숨김 인스턴스는 새 실행을 끝내고 focus만 받을 수 있다. 사용자가 조작할 UDT는 일반 창으로 실행한다. 숨김 실행의 소유권·정확한 PID/경로·작업 비활성이 확인된 인스턴스만 정리한다. 실제 crash면 같은 시각의 로그를 조사한다.
- 빌드 뒤 빈 scratch/helper 설정: Vite가 dist를 비운 뒤 public의 빈 배포 템플릿이 복사된다. 제공된 빌드의 종료 단계에서 기존 helper 연결정보를 재사용해 로컬 sidecar를 생성해야 한다. public 템플릿에 토큰을 넣지 않는다. 올바른 빌드·Reload·ping까지 확인한 뒤 출력을 재개한다.
- helper 설치 파일은 있지만 기능 실패: 설치 manifest와 live heartbeat/capability를 구분한다. 해당 기능에 필요한 helper만 진단한다. UXP Reload는 CEP/SDK 설치나 정상 앱 재시작을 대신하지 않는다.

timeout 뒤는 UNVERIFIED다. active 작업은 기다리고 종료된 exact root의 archive는 lease만 해제한다. 원래 영수증을 고치거나 lock을 직접 삭제하지 않는다. 새 수정 전 영향받은 상태를 읽는다. 설치·통신·배포·콘텐츠·화면 증거를 나눠 실제 확인한 경계만 보고한다.
