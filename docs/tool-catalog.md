# MCP 도구 선택
실제 tools/list 스키마·프로필과 [지원 상태](release-status.md)를 우선한다. [운영 계약](agent-contract.md)이 공통 규칙이다.

| 의도 | 도구 | 선택·증명 경계 |
|---|---|---|
| 시작·연결 | get_agent_context, premiere_ping, get_capabilities | fresh IDs, 실제 배포. ready와 사용자 승인 구분 |
| 좁은 발견 | query_timeline, query_media | 필터/페이지/상세 한도. truncated 결과는 전체 아님 |
| 클립 인자 준비 | prepare_clip_edit | 준비 후 실제 편집 호출 필요 |
| 프로젝트·미디어 | create_bin, rename_project_items, move_project_items, set_project_item_labels, import_media, create_proxy, attach_proxy, create_subclip | 정확한 대상·부모·source readback. source 읽기 전용 |
| 프로젝트·시퀀스 생성/전환 | create_working_copy, duplicate_working_sequence, create_sequence, activate_sequence | 요청에 필요할 때만 생성. 기존 편집 전제 아님 |
| 배치·상태·선택 | place_clips, place_on_new_layer, set_track_state, set_timeline_item_state, set_timeline_selection | 실제 stream/range·보존, selection/targeting/mute 구분 |
| 정밀 클립 편집 | split_clips, trim_clip_exact, trim_clips, clone_clips, move_clips, move_clip_to_track, remove_clips | 지원된 A/V·전환·속도 조건과 exact ticks |
| 트랙 반복·간격 | prepare_track_wave, submit_track_command_sequence, prepare_timeline_ripple, ripple_timeline | submit once·terminal preservation·caption 별도 proof |
| 트랙 잠금 | read_track_locks, set_track_locks | 전용 helper/0.15.1, explicit lock 값, caption/자동 unlock 미지원 |
| 모션·재구도 | set_transform, scale_clip_to_fill | source framing 유지. fill geometry 조건과 명시적 scale 구분 |
| 효과·오디오 | inspect_effect_catalog, get_effect_values, apply_video_effect, apply_audio_effect, set_effect_values, remove_effect, set_audio_level, set_basic_grade, apply_color_adjustments | 관측 selector/unit, duplicate instance, static/key 구분 |
| 키프레임 | set_effect_keyframes, edit_effect_keyframes | exact sequence ticks·SDK mapping·보간 proof |
| 효과 표시·고급 curve | set_effect_disclosure, get/set_speed_graph_disclosure, get/set_lumetri_rgb_curve, get/set_lumetri_hue_saturation_curve | header/graph/value 구분, 특수 저장/재열기·digest |
| 전환 | apply_transition, remove_transition | type/edge/duration·실제 native readback |
| 효과 job | submit_effect_command_sequence, get_effect_command_sequence_status, cancel_effect_command_sequence | 접수 PARTIAL, 단계별 proof, 전체 rollback 없음 |
| 이벤트·복구 | wait_runtime_events, get_mutation_recovery, archive_inactive_operation, reconcile_mutation | no replay, 이벤트와 terminal proof 구분 |
| 프레임·화면 | capture_program_frame, export_review_frames, focus_timeline | 합성 image와 native UI proof 구분. 기본 마지막 위치 유지 |
| 자막 | inspect_caption_helper, inspect_caption_track, apply_srt_to_caption_track, edit_caption_items, import_caption_track, inspect_selected_caption_font, set_selected_caption_font_style | 문구 preview/실제 지원 구분. import timingVerification과 생성 트랙 identity 확인; 불일치 재실행 금지 |
| 자막 큐별 서체·크기·색 | inspect_sequence_structure, edit_existing_sequence_structure(captionStyle.items) | exact track UID/ID/count + itemIndex/start/end ticks. 저장·닫기·재열기, archive 값/문구/시각 보존 및 UXP 구조 proof. 픽셀 렌더는 별도 확인 |
| 빈 트랙 삭제 | inspect_sequence_structure, edit_existing_sequence_structure(removeTracks) | 기본 trackRemovalRoute:archive. exact track/index/UID/ID/name/count, 검증된 닫기와 SHA 고정, 재열기·저장 뒤 생존 AV·노출 효과값/키·전환·자막 payload 보존. native는 명시적 버전 제한 경로이며 자동 fallback 없음 |
| 그래픽 | create_editable_text_mogrt, create_editable_rectangle_mogrt, insert_editable_graphic, insert_mogrt_caption | editable native 결과·artifact hash·frame alignment. insert_mogrt_caption만 명시적 trailing_append 지원: 정확한 기존 항목 수와 video/audio 트랙의 끝까지 빈 구간·전환 없음 확인. 기본 empty_track 및 rectangle 제한 유지 |
| 전사 | inspect_clip_speech_text, import_clip_speech_text, open_native_speech_to_text_workflow | strict Adobe JSON·existing transcript 보호·IPC 접수와 완료 구분 |
| 마스크·native | inspect_premiere_feature_routes, inspect_native_visual_commands, activate_native_tool, inspect_object_mask_state, inspect_native_masks, track_object_mask_frames | 활성화/presence/생성/추적은 별개 |
| 선택적 외부 segmentation | capture_mask_seed_frame, collect_object_mask_prompt, inspect_segmentation_engine, segment_object_frame | 사용자 선택 시 seed receipt/model/hash; single frame 한계 |
| 저장·납품 | save_working_project, close_working_project, open_working_project, export_sequence, export_frame, verify_delivery, inspect_delivery_state | delivery 프로필. close는 저장 후 닫기. metadata와 시청 품질 구분 |

일부 legacy inspect 도구는 큰 요약 또는 native saved evidence를 읽는다. 이름만으로 무부작용으로 판단하지 말고 각 description을 확인한다.
[기능별 절차](../skills/USER-video-edit-premiere/SKILL.md) · [실제 스키마로 검사하는 예제](examples/agent-calls.json)
