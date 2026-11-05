# 실행 인자와 결과

예시는 template이며 실행 가능한 job 목록이 아니다. 변수는 현재 호스트 결과와 사용자 요청으로 채운다.

```javascript
const target = {
  expectedProjectId: context.project.id,
  expectedSequenceId: context.sequence.id,
  expectedSequenceName: context.sequence.name,
  trackItemId: item.id,
  expectedProjectItemId: item.projectItemId,
  expectedClipName: item.name,
  expectedMediaType: item.mediaType,
  expectedTrackIndex: item.trackIndex,
  expectedStartSeconds: item.start.seconds,
  expectedEndSeconds: item.end.seconds
};
const effect = {...target, componentIndex: component.componentIndex,
  componentMatchName: component.matchName};
const selector = {paramIndex: parameter.paramIndex,
  expectedDisplayName: parameter.displayName};
const read = await call("get_effect_values", {...effect, ...selector, detail:"parameter"});
// isError, content status, readStatus.value/animation부터 확인한다.
// 일반 자동 follow visibility는 콘텐츠 값의 사용 전제가 아니다.
// 특수 native sample/time proof와 명시적인 화면 요청은 각 계약을 확인한다.
const receipt = await call("set_effect_values", {
  ...effect,
  parameters:[{...selector, expectedValue:read.component.params[0].value, value:requestedValue}],
  operationId:recordedNewOperationUuid
});
```

MCP isError를 먼저 확인하고 structuredContent 또는 text JSON을 해석한다. native graphic의 없는 projectItemId는 빈 문자열과 실제 이름으로 유지한다. 가짜 소스 ID를 만들지 않는다.

Point 쓰기는 {kind:"point",x,y}, Color는 {kind:"color",red,green,blue,alpha?}다. 읽기 배열을 쓰기 타입으로 가정하지 않는다. 정적 쓰기 전에 실제 키/animation을 읽는다. values와 parameters는 동시에 주지 않는다.

공개 save_working_project 입력은 fresh expectedProjectId, expectedSequenceId, 선택 expectedSequenceName 및 operationId다. delivery 프로필과 사용자 요청 범위에서 저장하고 저장 후 실제 대상 readback을 확인한다.

| 결과 | 다음 행동 |
|---|---|
| pass | 실제 after와 요청된 보존 조건을 확인 |
| partial/queued/running | job 대기·상태 조회 계속 |
| fail + contentDispatched:false | 입력/대상/capability를 수정; 편집이 없다는 증거 유지 |
| fail/unsupported + 부분 적용 가능 | partialState/rollback과 실제 영향을 확인 |
| dispatch 뒤 timeout/unverified | [복구](recovery.md); 재제출 금지 |
| 이벤트 대기 timedOut:true | 대기만 다시 수행; job을 다시 제출하지 않음 |

[명령 묶음](jobs-events.md) · [효과](effects.md) · [검증](verify-deliver.md)
