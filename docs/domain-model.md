# 도메인 모델과 증명 의무
[현재 운영 계약](agent-contract.md)을 구현 가까이 해석하는 개발 문서다. 실제 타입/스키마와 host readback이 권위다.

## 식별자와 상태
- Project/Sequence: 현재 저장된 로컬 프로젝트와 시퀀스의 ID. 이름은 설명 또는 추가 guard이며 ID를 대신하지 않는다.
- Clip target: project/sequence, trackItemId, source projectItemId, media type, track, timeline start/end 및 필요 source range의 현재 관측.
- Effect/Parameter: exact clip + component index/matchName + parameter index/displayName. 중복 효과는 인스턴스 단위로 결합한다.
- Sequence/native source time: 서로 다른 clock. exact ticks는 문자열/BigInt로 보존하며 클립 끝은 제외한다.
- Operation: 한 의도의 ID/입력 fingerprint, 실행 단계·receipt·lease. 같은 입력 재호출은 영수증 반환이다.
- Job: 순차 step, symbolic binding, completed/total, preservation, terminal state. event revision과 결과 cursor는 별개다.
- Evidence: 호스트 값/구조, saved archive, native sample, 프레임/음성/UI, 파일 metadata의 증명 범위가 다르다.

## 불변식
1. 발견은 fresh unpinned, 후속 문맥 작업은 IDs pinned. 사용자 탐색 뒤 원래 대상을 재획득하고 정확한 target으로 readback한다.
2. 이동/분할은 clip ID, 효과 chain 변경은 index, 편집은 pagination을 무효화할 수 있다. host object를 트랜잭션 사이 영구 캐시하지 않는다.
3. prepare는 실행하지 않는다. 실제 mutation은 대상·형식·점유·효과 guard를 다시 확인한다.
4. 모든 native action 생성은 해당 Project.lockedAccess 경계 안에서 한다. shared runtime의 lease는 계획·dispatch·영수증 보존을 포함한다.
5. 사전 거절은 contentDispatched:false 증거로 구분한다. 앞선 쓰기가 있다면 후속 preflight 오류도 부분 적용이다.
6. timeout after dispatch는 UNVERIFIED다. immutable receipt와 live execution ledger로 판정하며 unknown replay를 하지 않는다.
7. archive는 비활성 operation의 lease만 해제한다. old result를 PASS로 바꾸거나 내용을 복원하지 않는다.
8. 기존 키는 static 변경으로 덮지 않는다. Point/Color·nonlinear time·native archive 경로의 특수 증명은 유지한다.
9. source와 NAS는 읽기 전용이다. 새 output/proxy/scratch는 artifact 경계에, 승인된 기존 프로젝트 저장은 그 로컬 프로젝트에 쓴다.
10. 자동 follow는 visible feedback이다. 일반 실패가 content status를 바꾸지 않는다. explicit UI 요청·특수 native 증명은 해당 계약을 따른다.
11. 반복 job은 단계별 proof를 가지며 전체 원자적 rollback을 약속하지 않는다. 취소 시 완료된 편집은 유지된다.
12. 모션 기반 재구도는 original source bounds와 후속 조절 가능성을 보존한다. fill 계산은 supported geometry에만 적용한다.
13. 빈 트랙 archive 삭제는 fresh host와 저장본의 exact ID/UID/index/name 및 empty count를 모두 요구한다. 공유 TrackGroup·생존 트랙·audio inlet의 유일 소유권을 검증한다. close의 자체 저장 후 의미를 다시 대조하고 닫힌 파일 SHA를 고정해 교체 직전까지 확인한다. 재열기·저장 뒤 생존 AV/노출 효과값·키/영상 전환/자막 payload의 인덱스 재매핑 보존으로 PASS를 판단한다. opaque graphic 원문/렌더는 이 증명의 범위 밖이다.

## 검증
- pure fixture/schema 테스트는 프로토콜 증거다. 실제 Premiere 편집·UI·영속성은 각각 live proof가 필요하다.
- 영향받은 값과 요청 보존 조건을 검사한다. 모든 명령에 동일한 전체 snapshot·reopen을 강제하지 않는다.
- 실패 후 rollback 성공 여부도 증거를 요구한다. 사용자 협업 내용이 바뀌었으면 오래된 전체 상태로 덮지 않는다.
- 현재 도구 설명은 선택 기준·입력 clock/unit·부작용·증명·재시도 경계를 포함한다. 주석은 이유를, 타입/검증 코드는 강제 조건을 맡는다.
