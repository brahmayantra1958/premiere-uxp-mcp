# 검증·저장·납품

| 요구 | 직접 증거 |
|---|---|
| 값/키 변경 | exact target의 before/after·native sample/time·키/보간 readback |
| 타이밍/구조 보존 | source/timeline ticks·track/clip·전환·요청 범위의 무관 항목 |
| 후속 확장 가능성 | 배치 뒤 각 클립의 남은 여유를 읽어 보고, 0이면 이유를 말한다. handles가 null이면 미확인; hard subclip과 음성 청취는 별도 |
| 구도/자막 표시 | capture_program_frame의 합성 이미지; 시작·중간·끝 등 위험 위치를 선택 |
| 원본 사운드 보존 | source·in/out·속도·gain/effects·연속성, 요청한 음질/끝 소리는 실제 음성 근거 |
| native 패널 표시 | visible panel과 해당 native state/log; Program frame으로 대신하지 않음 |
| 저장 | save_working_project의 정확한 project/sequence readback |
| 내보내기 | export_sequence 결과와 verify_delivery의 실제 파일 metadata; 필요한 시청 검수 별도 |

- 일반 follow는 best effort다. 화면 표시 자체가 요청이면 visibility의 exact effect/parameter/native proof(effectExpansion.status:"pass", 파라미터는 parameterScroll.status:"pass"·scope:"exact_parameter")를 요구한다. 특수 native 기능의 조건도 유지한다.
- 공개 save_working_project는 delivery 프로필과 fresh expectedProjectId/expectedSequenceId, 선택 name, operationId를 사용한다. close_working_project는 저장 후 닫으므로 변경 폐기 수단이 아니다.
- export output은 허용된 artifacts 경로, 기존 파일 미덮어쓰기를 지킨다. verify_delivery의 metadata_only와 특정 납품 프로필을 구별하며 특정 작품 규격을 다른 작업에 적용하지 않는다.
- 실제 결과를 PASS/PARTIAL/FAIL/UNVERIFIED/UNSUPPORTED로 나눈다. mock·파일 존재·프레임 수를 시청 품질의 증거로 대체하지 않는다.
- sourceRange 영상 배치는 독립 검수한 renderChecks 기준 PNG 해시와 실제 프로그램 프레임을 비교한다. 값만 맞거나 검은 화면이면 완료가 아니다. trim/split/ripple 구조 PASS에도 앞·중간·뒤 원본 대응 프레임과 소리를 확인한다.
- 화면에 보이는 샷을 판정할 때 가장 위 트랙이 항상 보인다고 가정하지 않는다. 해당 구간 클립의 disabled·트랙 상태와 source path·source in을 함께 읽고, 실제 합성은 capture_program_frame으로 확인한다.
- capture_program_frame과 export_review_frames는 Premiere가 초를 host ticks로 바꾼 뒤 가장 가까운 프레임으로 반올림한다(정확한 tick 중간값은 위 프레임). 소수 초의 +0.5프레임 경계는 변환 오차가 있을 수 있으므로 사용하지 않는다. 정수 N의 프레임 시작 `N * timebase / 254016000000`을 요청하고 반환된 frameIndex·ticks를 확인한다. 시퀀스 끝은 제외되므로 마지막 표본도 마지막 프레임 시작을 쓴다.
- 일반 검증에서 save/close/reopen을 반복하지 않는다. 특수 native 증명 또는 요청된 영속성 검증일 때만 해당 경로를 사용한다.
- 마지막 작업 위치에 남고 requested restoration만 수행한다.
- 인계에는 target IDs, operation/job ID, 마지막 cursor, 실제 변경·보존·남은 불확실성·증거 경로를 남긴다. 민감한 인증정보는 포함하지 않는다.
