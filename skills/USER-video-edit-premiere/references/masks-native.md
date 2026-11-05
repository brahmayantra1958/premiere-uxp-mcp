# 마스크·native 기능

기존 Premiere 기능이 목표다. public UXP, 실제 노출된 Adobe IPC, 설치된 기능별 native bridge 순으로 확인한다. public DOM에 없다는 이유로 외부 AI·모델 설치를 기본 경로로 시작하지 않는다.

- inspect_object_mask_state는 정확한 대상의 presence 조회다.
- activate_native_tool의 Selection/Razor/Object Mask 활성화는 독립 Tools 상태로 검증한다. Object Mask 생성 성공을 뜻하지 않는다.
- inspect_native_masks는 정확한 saved project를 읽기 위해 저장할 수 있다.
- track_object_mask_frames는 기존 Type 4 Object Mask, 정방향 1x video, 요청당 1–30프레임의 지원 범위를 확인한다. 실제 frame별 tracking과 archive proof를 요구한다.
- capture_mask_seed_frame은 exact clip/time·source mapping·PNG hash·보존을 결합한 seed receipt다. 일반 Program Monitor PNG로 대체하지 않는다.
- 외부 segmentation은 사용자가 선택한 보조 경로다. inspect_segmentation_engine의 실제 model/checkpoint/device/capability를 확인하며 서비스가 꺼져 있으면 성공을 가정하지 않는다.
- collect_object_mask_prompt와 segment_object_frame은 seed identity/hash·사용자 prompt·출력 hash/크기를 바인딩한다. single frame segmentation을 video tracking이나 native mask 생성으로 보고하지 않는다.
- native tool/parameter time/Color/Point 경로의 helper·OS 의존성을 확인한다. macOS에서 Windows native parity를 가정하지 않는다.
- 임의 CEP/QE/ExtendScript·메뉴 command dispatcher·합성 클릭/키 입력을 노출하거나 보안 설정을 바꾸지 않는다.
