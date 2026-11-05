# 캡션·그래픽·전사

- inspect_caption_track로 기존 cue의 정확한 identity/ticks/text/style을 읽는다. apply_srt_to_caption_track/edit_caption_items의 preview와 실제 적용 지원을 응답에서 구분한다. 모든 기존 문구·스타일을 수정할 수 있다고 가정하지 않는다.
- set_selected_caption_font_style은 정확히 하나 선택한 기존 caption의 font face에 한정된다. 전체 스타일·크기·여러 cue 편집으로 확장하지 않는다.
- 기존 큐별 fontPostScriptName/fontSize/fillColor(RGB 0–255)는 edit_existing_sequence_structure.captionStyle.items로 요청한다. inspect_sequence_structure는 프로젝트를 저장할 수 있고, 스타일 편집은 저장·닫기·다시 열기를 수행한다. 정확한 trackUid/expectedTrackId/name/count와 itemIndex/expectedStartTicks/expectedEndTicks를 고정한다. 다른 writer·사용자가 편집 중이면 lifecycle을 겹치지 않는다. 전체 트랙 font+size와 items는 별도 요청이며 문구·시간을 바꾸지 않는다. 지원하지 않는 다중 style run/불명확 binary layout을 강제로 편집하지 않는다.
- inspect_caption_track.savedSnapshot의 cue style은 저장본 증거이며 미저장 live style의 guard로 쓰지 않는다. 스타일 편집은 재열기 후 Premiere에서 다시 저장한 archive로 요청값과 보존 조건을 검증한다. archive 값과 실제 렌더가 같은지는 capture_program_frame으로 확인한다. 요청한 PostScript 이름이 저장됐다는 사실만으로 설치 글꼴 fallback이 없다고 단정하지 않는다.
- import_caption_track는 버전이 맞는 고정 SRT helper를 쓴다. SRT 입력은 읽기 전용이며 helper에는 bytes가 같은 scratch 사본을 전달한다. native frameTicks capability가 없는 패널에서는 생성 전에 거절한다. 새 track/count·rename/mute·AV 보존뿐 아니라 timingVerification의 cue별 actual/expected/delta를 확인한다. 기본 예상 시각은 도구의 nearest-half-up 프레임 정책이며 Adobe importer의 반올림 규칙을 뜻하지 않는다.
- import의 expectedTimingPlan은 정확한 frameTicks와 cue start/end ticks를 제공하는 **결과 검증 계획**이며 큐 배치를 강제하거나 원본 SRT를 보정하지 않는다. 계획과 실제가 다르면 생성된 트랙 identity와 시각을 보존한 UNVERIFIED다. 특히 23.976 SRT가 한 프레임 앞서는 관측을 모든 fps의 +1 보정으로 일반화하지 말고, 같은 요청을 다시 가져오거나 기존 불확실 receipt를 덮지 않는다. 자동 저장은 하지 않는다.
- inspect_caption_helper의 설치 manifest 버전과 live heartbeat는 별개다. helper 업데이트 필요 오류를 UXP Reload로 해결하려 하지 않는다. 실제 설치·정상 재시작 경계를 따른다.
- 편집 가능한 텍스트/도형에는 create_editable_text_mogrt/create_editable_rectangle_mogrt와 해당 삽입 도구를 선택한다. PNG로 구워서 편집 가능성을 대체하지 않는다.
- insert_editable_graphic의 empty existing track, artifact hash, exact project/sequence/count guard를 지킨다. generic 그래픽 전체의 live support를 가정하지 않는다.
- insert_mogrt_caption은 기본 empty_track을 유지한다. 실제 tools/list가 지원할 때만 insertionMode:trailing_append와 정확한 expectedVideoTrackItemCount를 함께 지정해 기존 그래픽 뒤에 추가할 수 있다. 지정 video/audio 트랙의 모든 항목이 삽입 시각 전에 끝나고 전환이 없어야 한다. 템플릿의 초기 길이는 미정이므로 중간 빈 구간에는 사용하지 않는다. 호스트가 읽을 수 없는 항목·전환·트랙 상태를 거절하면 검사를 생략하지 않는다.
- MOGRT 시간은 정수 프레임에서 ticks로 계산한다(초 = frames*frameTicks/254016000000). GRAPHIC_TIME_NOT_FRAME_ALIGNED를 소수 반올림 재시도로 해결하지 않는다. 출력 충돌(OUTPUT_ALREADY_EXISTS)은 새 의도의 새 operationId와 그 UUID를 붙인 새 파일명으로 처리하고 기존 출력이나 같은 operationId 입력을 바꾸지 않는다.
- inspect_clip_speech_text/import_clip_speech_text는 기존 project clip transcript와 strict Adobe JSON을 다룬다. 기존 transcript 덮어쓰기를 가정하지 않는다.
- open_native_speech_to_text_workflow는 실제 선언된 Adobe Text IPC가 있을 때 옵션 workflow를 요청한다. empty plugin inventory, 알려지지 않은 버전, 접수만 된 상태를 transcript 생성 완료로 보고하지 않는다.
- caption pixel 포함은 capture_program_frame의 실제 이미지를 확인한다. cue 데이터 조회와 화면에 보이는 자막은 별도 증거다.
