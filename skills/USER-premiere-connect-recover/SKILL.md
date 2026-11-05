---
name: USER-premiere-connect-recover
description: "Premiere UXP MCP를 처음 설치·설정하거나 연결·배포·Reload 오류를 해결하기. 동봉 Premiere 스킬의 미발견·자동 선택 누락도 설치 경로와 카탈로그에서 진단한다. CCX/UDT, MCP 프로필, 런타임·패널·helper와 작업 영수증을 대조해 필요한 적용·복구만 수행한다. 정상 연결에서의 클립·효과 편집은 편집 스킬로 진행한다."
metadata:
  contract_version: "1.0.0"
  display_name: "Premiere 연결·복구"
  version: "1.0.3"
---

# Premiere 연결·복구

처음 설치·세팅, 동봉 스킬 미발견·선택 누락, 누락 도구, 연결 실패, 잘못된 배포, UDT 창·Reload 문제, helper 오류와 불확실 실행에 사용한다. 정상 편집은 USER-video-edit-premiere로 진행한다.

1. 현재 설치 루트·CCX/UDT 방식·MCP 등록·실제 오류를 확인한다. 연결이 있으면 재사용하고 get_agent_context → premiere_ping으로 현재 대상과 live 배포를 확인한다. 연결이 없어도 아래 동봉 references를 읽을 수 있다.
2. 설치·프로필·스킬 등록 요청이면 [설치·설정 체크](references/setup.md)를 읽는다. 파일·환경별 설정을 구분하고 기존 설정·스킬·프로젝트를 보존한다.
3. 실행 실패·업데이트 적용·Reload 요청이면 [적용·복구 체크](references/reload-recovery.md)를 읽는다. 바뀐 실행 주체를 먼저 찾아 필요한 한 계층만 갱신한다. 재연결은 실행 중 owner의 코드를 갱신하지 않는다.
4. 작업이 active/queued이면 기다린다. UNVERIFIED는 exact root operation·host/job ledger와 영향받은 상태를 확인한다. 종료된 작업의 archive는 lease만 해제하고 원래 영수증/현재 내용을 유지한다. 과거 결과 판정이 필요할 때 reconcile_mutation을 사용한다. 이미 생성된 클립·효과·시퀀스를 다시 생성하지 않는다.
5. 해결한 경계의 readback으로 확인한다. 설치 receipt, 연결 ready, live 배포, 스킬 선택, 실제 편집을 각각 PASS/PARTIAL/FAIL/UNVERIFIED/UNSUPPORTED로 보고한다. 관찰하지 않은 편집·UI·자동 선택 성공을 주장하지 않는다.

설치·설정 정본은 [installation](premiere://guide/installation), 조치별 순서와 증상 표는 [operator-runbook](premiere://guide/operator-runbook)이다. MCP가 없으면 확인된 설치 폴더의 같은 문서를 읽는다. 현재 작업에 필요한 reference만 연다.

임의 lock 삭제, 보안 설정 변경, 사용자 앱 일괄 종료, 일반 shell/CEP/QE 표면 추가는 복구 방법이 아니다. 실제 UI 작업에만 지원되는 Computer Use와 수명주기를 적용한다. 네이티브 버튼 조작이 불가능하면 준비·진단을 완료한 뒤 필요한 한 번의 수동 조작과 이유만 요청한다. 완료 응답 뒤에는 readback을 먼저 확인한다.
