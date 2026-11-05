# Premiere 운영·복구 런북
[현재 계약](agent-contract.md)이 운영 정본이다. [설치](installation.md), [기능 상태](release-status.md), [운영 스킬](../skills/USER-video-edit-premiere/SKILL.md)을 필요한 범위에서 읽는다.

<a id="recovery-decision"></a>
## 무엇을 다시 연결할지 결정하기

먼저 현재 설치 루트, 설치 방식(CCX/UDT), 변경된 파일, MCP 프로필, 오류 시각을 확인한다. 연결이 가능하면 `get_agent_context`, `premiere_ping`, `get_mutation_recovery`를 읽는다. 연결이 끊겼으면 owner 상태·로그와 보존된 operation/job 영수증을 확인한다. 응답 부재를 작업 종료로 취급하지 않는다.

지원 패널의 복구 응답에는 `queueState`와 그래픽 삽입의 `diagnostics`가 추가된다. 현재 phase/native method, component/param 인덱스와 시작 시각을 보고 정체 위치를 구분한다. 이는 메모리 관찰 정보이며 content PASS·terminal proof·취소·lease 해제의 근거가 아니다. 반환하지 않는 native Promise를 timeout만으로 종료된 것으로 처리하지 않는다.

| 변경·증상 | 확인할 증거 | 필요한 조치 | 성공 확인 |
| --- | --- | --- | --- |
| 특정 도구가 없음 | 실제 `tools/list`, 등록 entry의 프로필 | 필요한 `inspect/edit/delivery` 프로필로 해당 MCP 클라이언트 재연결 | 새 목록에 요청 도구가 있음 |
| MCP 설명·지침·resource가 이전 내용 | initialize 정보, `resources/list/read`, 현재 bundle | 해당 MCP 클라이언트 재연결 | 새 서버 버전·문서 내용 |
| 공유 owner 코드·설정 변경 | 변경 파일의 실행 주체, owner PID·상태 | 활성 작업 종료 → 클라이언트 연결 중지 → 공식 owner stop/start → 재연결 | 새 owner 상태와 변경 경계의 readback |
| 전체 빌드에서 native worker 파일 사용 중 오류 | 정확한 실패 파일과 그 파일을 사용하는 owner | 활성 작업 종료·클라이언트 연결 중지 후 owner 정상 stop → 필요한 빌드 → start·재연결 | 빌드 종료 코드와 ready; 패널만 수정했다면 패널 빌드로 범위 축소 |
| UDT 패널 코드·로컬 sidecar 변경 | 등록된 절대 manifest 경로, 해당 경로의 빌드 결과 | 아래 Reload 절차 | live ping의 버전·mode·scratch 경로 |
| UDT manifest·권한·entrypoint 변경 | 등록 manifest와 변경 내용 | 활성 작업 종료 후 해당 항목 Unload → Load | 새 manifest에 해당하는 live 기능·배포 |
| CCX 설치본 교체 | 설치 방식과 설치 receipt | 설치 문서의 업데이트 절차 | Adobe 설치 결과와 별도 live ping |
| CEP/SDK helper 없음·구버전 | 설치 manifest와 실제 heartbeat/capability | 필요한 helper만 설치하고 정상 Premiere 재시작 | 해당 helper의 실제 기능 readback |
| UDT 창이 바로 사라짐 | 프로세스·창·시각·충돌 로그 | 아래 UDT 진단 | 정상 표시된 UDT 창 |
| scratch 경로가 비거나 다른 설치를 가리킴 | live `localScratchRoot`, 등록 경로, 로컬 dist sidecar | 올바른 루트에서 빌드 설정 생성 후 해당 패널에 적용 | 정확한 `artifacts/scratch` 경로 |
| 스킬이 선택되지 않음·예전 내용 | 클라이언트가 읽는 skills 경로, 이름·description·references·중복본 | 범위 지정 재설치 → 스킬 목록 갱신·새 대화 | 직접 표현·바꿔말한 표현·비대상 선택 검사 |
| timeout·끊긴 job·UNVERIFIED | root operation, active/queued 상태, host/job ledger | 기다리거나 아래 불확실 작업 절차 | 원래 receipt 유지, 현재 상태 판정 |

동일 증상에서 같은 Reload를 반복하지 않는다. 조치 한 번 뒤 같은 경계의 증거를 비교해 다음 원인을 좁힌다. 정상 편집 요청에는 설치·재시작 흐름을 끼워 넣지 않는다.

<a id="reload-steps"></a>
## UDT Reload 순서

1. `get_mutation_recovery`와 관련 job 상태로 실행 중·queued 작업이 없는지 확인한다. 미확인 편집은 ID와 영수증을 보존하고 영향을 읽는다. Reload로 결과를 판정하거나 잠금을 없애지 않는다.
2. UDT의 **Premiere UXP MCP** 항목이 의도한 설치의 `apps/uxp-plugin/dist/manifest.json`을 가리키는지 확인한다. 같은 이름의 항목이 여러 개면 절대경로로 구분한다. 필요한 코드 빌드를 그 루트에서 완료한다.
3. 코드·sidecar만 바뀌면 해당 항목에서 **Reload**를 한 번 실행한다. manifest가 바뀌었으면 **Unload → Load**를 사용한다. 진행 중 사용자 편집을 중단하거나 프로젝트를 저장·닫는 일을 Reload의 전제에 추가하지 않는다.
4. 패널 연결을 확인하고 `premiere_ping`을 다시 읽는다. `premiere.deployment.panelVersion`, `panelMode: agent`, `localScratchRoot`가 의도한 빌드와 설치의 `artifacts/scratch`인지 확인한다. 버전이 같은 재빌드는 변경된 기능의 읽기 결과로 추가 확인한다.
5. `get_agent_context`로 현재 프로젝트·시퀀스를 다시 고정하고 `get_mutation_recovery`를 확인한다. 이전 job을 새 ID로 재제출하지 않는다. 필요한 최소 readback으로 복구한 경계만 판정하고 마지막 작업 위치를 유지한다.

현재 제공된 도구가 네이티브 UDT 버튼 조작을 지원하지 않으면 빌드·경로·작업 상태 점검까지 마친 뒤 사용자에게 **해당 항목의 Reload 한 번**만 요청한다. 이때 네이티브 버튼 조작 도구가 없어서 필요한 단계임을 밝힌다. 이미 사용자가 완료했다고 응답했으면 live ping을 먼저 확인한다. 재요청은 새 수정 또는 적용 실패 증거가 있을 때만 한다. 지원되지 않는 입력·숨은 디버깅 우회로 대신 실행하지 않는다.

## owner 상태와 로그

설치 루트에서 Setup이 기록한 Node를 사용한다. 전역 Node 설치는 필요 없다. 아래 명령은 상태만 읽는다.

```powershell
$premiereNode = (Get-Content -LiteralPath './artifacts/install/node.json' -Raw | ConvertFrom-Json).executable
& $premiereNode './apps/mcp-server/dist/runtime-cli.js' status
```

macOS에서는 설치 루트에서 다음을 사용한다.

```sh
premiere_node=$(/usr/bin/plutil -extract executable raw -o - ./artifacts/install/node.json)
"$premiere_node" ./apps/mcp-server/dist/runtime-cli.js status
```

위 표에서 owner 재시작이 필요한 경우에만 활성 작업 종료와 클라이언트 연결 중지를 확인한 뒤 같은 명령의 `status`를 `stop`으로 바꾼다. 종료 상태를 확인하고 `start`, 클라이언트 재연결, `ready` 순서로 확인한다. `start`는 통신만 시작/재사용하고 `ready`는 현재 로컬 프로젝트·시퀀스까지 읽는다. 기존 인증을 쓰는 복구에서 `--pair`를 매번 붙이지 않는다. `PREMIERE_MCP_CONFIG`를 사용한다면 같은 설정 파일로 실행한다.

| 증거 파일 | 용도 |
| --- | --- |
| `artifacts/install/receipt.json` | 설치 단계별 PREPARED/FAILED 등; live 로드 증거와 구분 |
| `artifacts/runtime/runtime-daemon-state.json` | 해당 owner의 PID·발견 정보; 직접 수정하지 않음 |
| `artifacts/runtime/runtime-daemon.stdout.log`, `runtime-daemon.stderr.log` | 런타임 시작·연결 오류의 시각과 원인 |
| `artifacts/audit/operations.jsonl` 및 job/recovery 조회 | 요청과 실제 변경·미확인 작업 연결 |
| UDT 로그·운영체제 충돌 로그 | UDT 창 문제의 실행 시각과 종료 원인 |

로그를 공유할 때 토큰·인증파일 내용은 제외한다. 동적 control port는 상태에서 발견하며 6000 같은 Fetch 금지 포트를 고정하지 않는다.

## 연결·배포 원칙

- MCP 프로필과 현재 tool 목록을 먼저 확인한다. 정상 실행 중 owner runtime을 중복 시작하지 않는다.
- runtime:status/start:ready는 설치 루트의 package scripts다. control port는 런타임 상태에서 발견하며 Fetch-forbidden port를 직접 지정하지 않는다.
- UDT는 절대 manifest 경로를 등록한다. build 경로와 실제 로드 경로를 ping으로 대조한다.
- stdio 전용 코드·프로필·지침은 해당 클라이언트 재연결, owner가 읽는 코드·설정은 위 표의 owner 재시작 절차를 따른다. 패널 code-only는 필요한 Reload, manifest는 Unload→Load다.
- job 실행 중 Reload 또는 사용자 앱 강제 종료를 하지 않는다. CEP helper 설치/재시작과 UXP Reload를 구분한다.
- 일반 작업에 UI 자동화나 model bridge 채팅은 필요 없다. 실제 UI 확인 시에만 Computer Use를 사용하고 비UI 작업·대기 전에 정리한다.

### UDT 실행 직후 창이 사라질 때

- 먼저 UDT 프로세스·창 핸들·시작 시각과 Application Error/UDT 로그를 대조한다. 살아 있는 숨김 인스턴스를 앱 충돌로 단정하지 않는다.
- UDT 2.3.0은 중복 실행 시 새 프로세스를 종료하고 기존 창에 focus만 보낸다. Hidden으로 시작한 창은 이 경로로 다시 표시되지 않을 수 있다. 사용자가 조작할 UDT를 숨김 백그라운드 서버로 실행하지 않는다.
- 숨김 실행의 소유권과 정확한 PID/경로가 확인됐고 진행 중 job이 없을 때 해당 UDT 인스턴스만 정리한다. 사용자가 창을 필요로 하는 복구에서는 일반 창으로 실행하고 Premiere·owner runtime·프로젝트는 유지한다. 사용자 앱 일괄 종료·설정 초기화·Adobe 설치 파일 수정은 하지 않는다.
- 프로세스가 실제로 종료됐다면 같은 시각의 충돌 기록과 UDT 로그로 원인을 좁힌다. 숨김 인스턴스 조치를 다른 원인에 반복 적용하지 않는다.

### 빌드 뒤 scratch/helper 설정이 사라질 때

패널 재빌드는 dist를 비우므로 build 종료 시 로컬 deployment-config.js를 다시 생성한다. public 원본은 배포용 빈 템플릿으로 유지한다. Reload 뒤 ping의 localScratchRoot가 현재 설치의 artifacts/scratch인지 확인하고, 빈 값이면 편집·프레임 출력 전에 빌드 설정부터 고친다. 기존 helper 연결파일을 재사용하며 토큰을 새로 만들거나 public 템플릿에 복사하지 않는다.

## 불확실 작업

[복구 상세](../skills/USER-video-edit-premiere/references/recovery.md)를 따른다.
활성/queued는 기다린다. 종료된 정확한 root operation은 공식 archive로 lease를 해제할 수 있으며 과거 영수증과 현재 내용은 유지된다.
archive를 같은 편집 재제출 허가로 사용하지 않는다. 영향받은 상태를 읽고 필요한 수정만 새 의도로 보낸다.
과거 결과 자체를 판정하려면 reconcile_mutation을 사용한다. 직접 lock 삭제·unknown replay·백업으로 사용자 변경 덮어쓰기를 하지 않는다.

## 기능별 운영

| 영역 | 실행 참고 |
|---|---|
| 소스·bin·proxy | [대상과 미디어](../skills/USER-video-edit-premiere/references/targets-media.md) |
| 클립·트랙·ripple | [타임라인](../skills/USER-video-edit-premiere/references/timeline.md) |
| 값·키·색상·오디오 | [효과](../skills/USER-video-edit-premiere/references/effects.md) |
| 반복 작업 | [명령 묶음](../skills/USER-video-edit-premiere/references/jobs-events.md) |
| 자막·그래픽·전사 | [캡션과 그래픽](../skills/USER-video-edit-premiere/references/captions-graphics.md) |
| native·Object Mask | [마스크](../skills/USER-video-edit-premiere/references/masks-native.md) |
| 저장·내보내기·검수 | [검증](../skills/USER-video-edit-premiere/references/verify-deliver.md) |

## 종료와 인계

필요한 terminal proof와 요청 보존 조건을 확인한다. 저장/내보내기는 사용자 요청 범위에서만 수행한다.
마지막 작업 위치에 남고, 완료/부분 적용/미확인·operation/job ID·증거·재개점을 기록한다.
특수 기능이 요구하지 않는 전체 재검사·save/close/reopen·focus 복원을 붙이지 않는다.
