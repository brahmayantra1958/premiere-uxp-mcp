# AI에게 맡기는 Premiere UXP MCP 설치

이 파일과 **같은 배포 패키지 전체**를 Codex, Claude Code 또는 Gemini(Antigravity)에 제공하고 “이 가이드대로 설치해 줘”라고 요청하세요. 설치기는 선택한 클라이언트의 MCP 항목과 동봉 스킬 4개를 설치합니다. Adobe 제품 설치·계정 로그인·Adobe 확인 창 승인은 사용자가 진행합니다. Windows x64가 1차 지원 환경이며 macOS는 실험적입니다. 다른 PC에서의 전체 설치 검증은 아직 완료하지 않았습니다.

## 에이전트 실행 순서

1. **소스를 찾는다.** 이 파일 옆에 `Setup.cmd`, `Setup.command`, `package-lock.json`, `installer`가 있는지 확인한다. 파일 하나만 전달받았고 나머지가 없으면 배포 ZIP 또는 저장소 위치를 확인한다. 존재하지 않는 공개 다운로드 주소를 추측하지 않는다. 패키지를 계속 보관할 쓰기 가능한 로컬 폴더에 풀고 해당 폴더에서 작업한다. NAS·ZIP 뷰어·Program Files에서는 실행하지 않는다.
2. **환경과 클라이언트를 확인한다.** Premiere Pro 26.3 이상과 Creative Cloud Desktop, 인터넷이 필요하다. 일반 사용자는 CCX 경로를 사용하므로 UXP Developer Tool을 따로 설치할 필요가 없다. 현재 요청을 실행하는 클라이언트를 선택한다. Codex는 `codex`, Claude Code는 `claude`, Gemini(Antigravity 앱·CLI)는 `gemini`, Codex와 Claude Code 둘 다는 `both`, 수동 설정은 `none`이다. Premiere가 켜져 있으면 사용자가 저장하고 정상 종료하도록 안내하며 강제 종료하지 않는다. 설정이 실행 중인 클라이언트에 의해 다시 쓰이지 않도록 설치 후 그 클라이언트를 재시작한다.
3. **Setup을 실행한다.** 아래 명령 중 실제 OS에 맞는 하나를 사용한다. Node/npm은 설치기가 공식 배포본의 고정 SHA-256을 확인해 준비하므로 전역 설치가 필요 없다. 에이전트 실행은 `--non-interactive`와 선택 클라이언트를 명시한다. Adobe의 설치 확인·권한 창은 사용자에게 전달한다. 개발자 모드·레지스트리·보안 정책을 우회하지 않는다.

```powershell
# Windows: Claude Code는 -Client claude, Gemini는 -Client gemini, Codex와 Claude Code 둘 다는 -Client both
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\bootstrap.ps1 -Client codex -NonInteractive -NoConnect
```

```sh
# macOS (실기기 검증 전): Claude Code는 --client claude, Gemini는 --client gemini
/bin/bash Setup.command --client codex --non-interactive --no-connect
```

4. **설치 결과를 읽는다.** `artifacts/install/receipt.json`의 `INSTALLED`, 선택 클라이언트별 `PASS`, `skillsVerified: true`, `skillCount: 4`를 확인한다. `PREPARED`는 개발용 빌드만 끝난 상태다. `FAILED`는 실패 단계부터 원인을 해결한다. 기존 다른 MCP 항목과 스킬은 보존한다. 충돌 시 `client-plan.json`을 읽고 해당 `premiere` 항목·스킬 변경을 비교한다. 사용자가 선택한 이전 설치를 교체하는 범위가 확인된 경우에만 `--replace-client` 또는 `--replace-skills`를 사용한다. 백업은 설치 폴더의 `artifacts/client-install-backups`와 `artifacts/skill-install-backups`에 남는다. 구성 파일·로그·토큰을 답변이나 공개 패키지에 복사하지 않는다.
5. **Adobe와 연결한다.** 사용자가 Premiere에서 저장된 로컬 프로젝트, 사용할 시퀀스, **Window → UXP Plugins → Premiere UXP MCP** 패널을 열도록 안내한다. 최초 Adobe `shell.openPath` 동의가 뜨면 사용자가 승인한다. Windows는 `installer/connect.ps1`, macOS는 `Connect.command`를 실행한다. `artifacts/install/connection.json`이 `PASS`인지 확인한다. 이 검사는 연결과 패널 버전·모드·현재 설치 경로를 대조하며 시퀀스를 변경하지 않는다. 실패하면 [복구 런북](docs/operator-runbook.md)을 따른다.
6. **클라이언트에서 확인한다.** 선택한 클라이언트를 다시 연결하거나 새 세션을 열어 `premiere` MCP와 스킬 4개가 검색되는지 확인한다. Claude Code는 `claude mcp get premiere` 및 `/mcp`로 실제 적용된 정의를 확인한다. Antigravity는 MCP Servers에서 `premiere`를 다시 시작하고(CLI는 `/mcp`로 다시 읽음) 새 대화를 연다. 작업 공간의 `.agents/mcp_config.json`에 같은 이름의 항목이 있으면 그 작업 공간에서는 그 항목이 적용될 수 있다. 같은 이름의 프로젝트/로컬 설정이나 조직 정책이 사용자 설정보다 우선할 수 있다. `tools/list`, `resources/list/read`, `get_agent_context`, `premiere_ping`, `get_mutation_recovery`를 확인한다. 현재 프로젝트·시퀀스와 `premiere.deployment.panelVersion`, `panelMode: agent`, `localScratchRoot`를 설치 파일 및 경로와 대조한다. 연결 확인을 위해 임의 편집·프로젝트 복제·저장을 하지 않는다.

최종 보고는 **설치 / MCP 실제 연결 / 스킬 파일 설치 및 실제 검색 / 편집 검증**을 각각 `PASS`, `PARTIAL`, `FAIL`, `UNVERIFIED`, `UNSUPPORTED`로 표시한다. 파일 병합이나 fixture 테스트만으로 다른 PC의 Premiere 설치·편집이 검증됐다고 보고하지 않는다.

## 수동 재등록과 개발 경로

Setup 이후 MCP·스킬만 복구할 때는 `artifacts/install/node.json`의 Node로 `installer/client-registration.mjs --client codex`를 실행해 계획을 확인하고, `--apply`로 적용한다. Claude Code는 `--client claude`, Gemini(Antigravity)는 `--client gemini`를 쓴다. 한 클라이언트에 한해 `--config <절대 파일 경로>`와 `--skills-target <절대 폴더>`를 지정할 수 있다. 설치기는 실제 설정의 `premiere` 항목만 병합하고 그 외 값을 보존한다. TOML 구조를 안전하게 병합할 수 없으면 원본을 수정하지 않고 중단한다.

개발자는 `node installer/install.mjs --prepare-only` 이후 UDT에 **현재 폴더의** `apps/uxp-plugin/dist/manifest.json`을 등록하고 Load한다. 이 모드는 Adobe 플러그인·클라이언트·개인 스킬을 설치하지 않는다. UDT 경로는 [설치 상세](docs/installation.md#developer-loading)를 따른다. CCX와 UDT 복사본을 동시에 로드하지 않는다.

일부 Windows 네이티브 효과 검증·도구 활성화 기능은 별도의 Adobe SDK 보조 플러그인이 필요하다. 기본 소스 패키지가 이를 제공한다고 가정하지 말고 [기능별 지원 상태](docs/release-status.md)를 확인한다. 원본 코드의 [0BSD 라이선스](LICENSE)와 [제3자 고지](THIRD_PARTY_NOTICES.md)는 적용 대상이 다르다. 전체 설치·업데이트·제거는 [설치 상세](docs/installation.md), 편집 작업은 [에이전트 가이드](docs/agent-start-here.md)를 따른다.
