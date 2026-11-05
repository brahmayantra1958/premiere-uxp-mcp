# 명령 묶음과 이벤트

같은 효과의 여러 값은 한 parameters 배열을 먼저 선택한다. 여러 효과/클립 단계는 submit_effect_command_sequence를 사용한다. clips 1–20, 초기 effects 최대 64, steps 1–256이며 초과 요청은 terminal 검증 뒤 다음 묶음으로 나눈다.

1. wait_runtime_events({})로 제출 전 sessionId/nextRevision을 얻는다.
2. effect payload는 {operationId,sequence:{protocolVersion:1,clips,effects,steps,maxRunMs}}다. exact project/sequence/clip guard는 clips[] 각 binding에 들어간다. clips는 [{...exact target, ref}], effects는 [{ref,clipRef,componentIndex,componentMatchName}]이며 sequence 루트에는 guard를 넣지 않는다.
3. steps의 add_video/add_audio/read/set_values/set_keys/edit_keys/remove/disclosure를 목적에 맞게 조립한다. symbolic ref는 추가/제거 후 재결합되며 제거한 ref를 재사용하지 않는다. 예: {op:"set_values",effectRef,parameters:[{paramIndex,expectedDisplayName,expectedValue,value}]}.
4. 트랙 반복 이동은 prepare_track_wave의 tool/arguments를 한 번 제출한다. 일부 대상 요청에는 trackItemIds를 반드시 명시한다. 생략하면 첫 트랙 전체가 대상이다. route는 0-based track 배열이다(기본 [0,1,2,1,0]은 V1→V2→V3→V2→V1, minIntervalMs 기본 0은 의도적 지연 없음).
5. effect jobId는 accepted.jobId, track은 accepted.hostResult.jobId다. operationId와 함께 기록한다.
6. wait_runtime_events({sessionId,afterRevision:nextRevision,jobId,terminalOnly:true,timeoutMs:30000})로 기다린다. 반환 revision으로 갱신한다. hasMore:true면 반환된 nextRevision으로 이어 읽는다. 정상 timedOut은 대기만 반복한다.
7. terminal 뒤 get_effect_command_sequence_status 또는 get_track_command_sequence_status({jobId,cursor:0})를 읽는다. hasMore가 없어질 때까지 nextCursor를 따른다(effect 25개·track 50개 단위). event revision과 결과 cursor는 별개다.
8. state:"pass", completedSteps===totalSteps, preservation.expectedState:"pass"를 확인한다. 왕복 요청은 returnedToStart:true도 확인한다. 트랙 job의 quarantineReleased:true 또는 후속 recovery.quarantined:false를 확인한 뒤 다음 편집을 보낸다.

접수는 PARTIAL이다. 이벤트는 완료 증거를 대신하지 않는다. 각 단계는 검증되지만 전체 원자적 rollback은 없다. 취소는 단계 사이에서 멈추며 완료한 편집은 남는다. 실행 중 호스트 조회/편집을 겹치지 않는다.

resetRequired/overflow/closed/재시작이면 cached status·복구 상태·현재 영향을 확인한다. 미완료 job 자동 재개·replay·실행 중 Reload를 하지 않는다.

일반 read/set/add/remove 단계는 content proof와 보존으로 진행하고 visibilityStatus는 별도 표시 결과로 남긴다. 자동 follow 미확인만으로 멈추거나 같은 편집을 재실행하지 않는다. 명시적 disclosure 단계는 실제 펼침/접힘 증명이 필요하며, 접힘에 파라미터 스크롤을 요구하지 않는다. 특수 Point/time/color native 증명은 유지된다.
