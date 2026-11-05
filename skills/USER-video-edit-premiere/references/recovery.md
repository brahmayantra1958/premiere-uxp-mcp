# 불확실 실행과 복구

1. get_mutation_recovery에서 quarantined, 정확한 root operationId, owner/client/process, live command/job 상태를 읽는다. 조회 status:pass와 quarantined:false는 다른 사실이다. owner의 processId는 lease를 연 MCP 서버 프로세스이고, 이전 lease의 clientName은 unknown일 수 있다. 사용자의 화면 이동은 이 lease를 만들지 않는다.
2. 활성/queued 작업이면 완료를 기다린다. 실행 중 Reload·잠금 삭제·중복 제출을 하지 않는다. event 대기 timeout은 job 실패가 아니다.
3. contentDispatched:false인 preflight 거절이면 잘못된 입력/대상/지원 조건을 고친다. 앞 단계 쓰기가 있었다면 내부 preflight 오류도 부분 적용일 수 있다.
4. 종료된 이전 작업이 새 요청을 막으면 archive_inactive_operation에 정확한 root ID를 전달하고 leaseReleased:true를 확인한다. 현재 내용을 복원·재편집하지 않으며 과거 UNVERIFIED 영수증은 그대로 남는다.
5. 이전 작업 결과 자체를 판정해야 할 때 reconcile_mutation을 사용한다. 성공 여부·quarantineReleased와 native terminal proof를 구분한다.
6. 현재 대상에 실제로 남은 값을 읽고 필요한 수정만 새 의도로 실행한다. unknown insert/place/split은 같은 작업을 새 UUID로 반복하지 않는다. 백업이나 오래된 상태로 사용자 변경을 덮어쓰지 않는다.
7. 효과 초기화 실패라면 해당 chain/partialState를 확인한다. 이미 추가된 효과는 값만 수정하고, 없을 때만 새로 추가한다.
8. runtime 재시작 뒤에는 cached receipt와 host ledger를 대조한다. 미완료 job을 자동 replay/resume하지 않는다.

새 패널이 제공하는 `queueState`는 queued/running/settled의 관찰값이다. 그래픽 삽입의 `diagnostics.current`에는 현재 단계·native method·component/param 인덱스·시작 시각이 들어간다. 진단은 최근 호출만 보관하며 값이나 파일 경로를 넣지 않는다. 오래 대기한다고 terminal 상태가 되지 않으며, 이 정보로 잠금을 풀거나 자동 rollback하지 않는다. 원인 보고에는 exact operation ID와 이 진단을 함께 남긴다.

연결·helper·설치 문제는 USER-premiere-connect-recover 또는 MCP premiere://guide/recovery를 사용한다. 재시작·설치가 승인된 작업 범위에 있으면 필요한 절차만 진행하며 사용자 작업을 임의로 닫지 않는다.
