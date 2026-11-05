# 대상과 미디어

get_agent_context의 project.id/sequence.id를 expectedProjectId/expectedSequenceId로 전달한다. 도구가 요구하는 expectedSequenceName은 실제 sequence.name을 사용한다. Project item 이름으로 추측하지 않는다.

- query_timeline: IDs/이름/트랙/시간/선택으로 한정. 기본 20, 최대 100. includeEffects 또는 includeSourceMetadata이면 최대 20. page.hasMore 동안 page.nextOffset을 사용한다.
- query_media: IDs/이름/직계 binId, 최대 100. 같은 필터의 page.nextCursor를 cursor에 전달하고 offset은 생략한다. nextOffset 방식도 지원한다. 전체 탐색을 500개 요약 inspect_project로 대체하지 않는다.
- scanTruncated:true면 전체 부재를 판정하지 않는다. 편집 뒤 cursor/offset과 영향받은 ID/index를 새로 얻는다. 사용자나 다른 작업이 바꿨을 수 있는 대상은 다음 명령 전에 현재 값을 다시 읽는다.
- 효과 발견은 해당 클립에 includeEffects:true, limit:1. 파라미터 하나는 get_effect_values(detail:"parameter"). 전체 체인은 보존 증거가 필요할 때만 읽는다.
- 트랙은 0부터 센다(V1=video 0, A2=audio 1). import_media.after.importedItems의 실제 id/path/parentId를 재사용한다. 매 파일마다 전체 프로젝트를 스캔하지 않는다.
- 명시적 절대 입력은 어느 로컬 폴더/NAS든 읽기 전용으로 받는다. 작품별 sourceRoots 추가나 NAS 재귀 탐색이 필요 없다. SRT는 같은 입력 정책을 거쳐 helper용 scratch 사본을 받는다.
- rename_project_items의 ProjectItem 이름과 Sequence.name은 별도 관측값이다. 정확한 부모 아래 빈 생성 후 오류가 나면 query_media(binId)로 실제 자식 ID부터 읽고 재생성하지 않는다.
- duplicate_working_sequence는 생성과 이름 변경의 부분 적용을 구분한다. 실패/불확실 응답에 createdSequenceId 또는 after.id가 있으면 다시 복제하지 않는다. fresh context로 현재 활성 대상을 확인하고, 이미 생긴 정확한 시퀀스의 필요한 이름·내용만 복구한다. 내부 구현은 Sequence.getProjectItem의 직접 연결을 검증하며 500개 목록에서 이름으로 추측하지 않는다.
- 일반 목록/상태 조회는 위치를 보존한다. 지정 ID/이름/bin 조회는 대상을 표시할 수 있으므로 필요 없는 focus/select를 겹치지 않는다.
- 조회 도구도 화면 이동·PNG 생성·특수 증거용 저장 같은 부작용이 있을 수 있다. 이름만으로 무부작용이라 판단하지 말고 도구 설명을 확인한다.
