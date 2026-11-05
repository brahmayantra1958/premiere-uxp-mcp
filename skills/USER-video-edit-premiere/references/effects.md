# 효과·키프레임·색상·오디오

installed catalog와 해당 클립의 정확한 componentIndex/matchName/paramIndex/displayName을 관측한다. 동일 이름의 중복 효과를 이름 하나로 선택하지 않는다. 추가/제거 뒤 다시 결합한다.

- set_effect_values는 static 값이다. 실제 키가 있으면 set_effect_keyframes/edit_effect_keyframes를 사용한다. timeVarying:true, 키 0개인 base 값만 preserveEmptyAnimation:true를 명시한다.
- apply_video_effect/apply_audio_effect의 initialValues는 display-name 키, initialParameters는 indexed selector다. 숫자 문자열을 표시 이름으로 전달하지 않는다.
- 삽입 후 초기화 실패는 componentIndex/partialState/rollback을 확인한다. 효과가 이미 존재하면 값만 수정하고, 없음을 확인한 경우만 추가한다. ensure_effect_values나 같은 ID의 단계 재개를 가정하지 않는다.
- dependencies의 observe는 선언한 관계를 검증, apply는 명시한 출력도 같은 guarded transaction에서 쓴다. expectedDerivedParameters는 Premiere가 계산한 값을 검증한다. 상시 연동이나 비공개 규칙 발견 기능이 아니다.
- get_effect_values.timeSeconds는 sequence time. query_timeline.effectSampleTimeSeconds와 keyframeDetails.clipTime/time은 native source clock이며 클립 상대 0초 기준도 아니다. 비교는 sequenceTime을 사용한다. 키 쓰기 시각은 조회한 sequence timeTicks를 우선 쓰고 timeSeconds와 함께 보내지 않는다. detail:"chain"은 native 0의 전체 보존 조회이며 timeSeconds를 받지 않는다.
- video 시각 매핑은 역재생/일정 배속/램프 모두 exact SDK proof를 요구한다. 최대 64 distinct times. sequenceTime:null 또는 불완전 nativeSample을 추정값으로 채우지 않는다.
- 보간은 native source-time 기준이다. Point와 Color는 기능별 save/native read 조건을 유지한다. 일반 follow 실패와 특수 native proof 부족을 구별한다.
- set_effect_disclosure는 효과 header, set_speed_graph_disclosure는 별도 Speed 그래프 화살표다. 헤더 펼침으로 하위 그래프·값 편집 완료를 보고하지 않는다.
- Lumetri RGB/Hue curves 및 Speed graph는 필요한 경우에만 사용한다. saved digest guard와 저장·닫기·재열기·독립 readback이 있는 느린 경로다. 일반 값/header 조회에 대체 사용하지 않는다.
- RGB x/y는 [0,1], 2–32점, reset은 [{x:0,y:0},{x:1,y:1}]. Hue/Saturation x=[0,1), y=[-1,1], x 오름차순, 빈 배열 reset. 반환된 전체 control digest를 사용한다.
- track mixer pan/volume과 intrinsic panner는 지원 도구가 없다. 실제 clip Volume 또는 지원되는 stereo Balance 경로를 쓴다. 검증된 Balance 저장 0..1의 UI -100..100 변환을 다른 효과에 일반화하지 않는다. 트랙 pan/volume 입력은 TRACK_MIXER_UNSUPPORTED로 거부된다. 모노 클립의 AUDIO_EFFECT_CHANNEL_LAYOUT_UNSUPPORTED는 효과를 넣지 않은 거절이므로 같은 요청을 반복하지 않는다. dual-mono 파생본은 사용자가 편집 가능성 손실 설명을 듣고 선택한 경우에만 만들고, 교체·효과 보존을 따로 readback한다.
- transition의 실제 타입·edge·duration·sidedness readback은 기능별 public/native archive 경로를 따른다. public 목록이 비어 있다는 이유로 성공·부재를 추정하지 않는다.
