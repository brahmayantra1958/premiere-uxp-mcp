# 설치·설정 체크

처음 설치·설정·MCP 등록·스킬 설치 요청일 때 읽는다. 최신 세부 명령과 지원 범위는 [설치 정본](premiere://guide/installation), [스킬 설치](premiere://guide/skills)에 있다. MCP가 끊겼으면 현재 MCP 등록의 server args에서 실제 설치 루트를 찾고 그 루트의 docs/installation.md와 skills/README.md를 읽는다. 루트를 확인할 근거가 없으면 설치 위치만 질문한다. 개발 PC 경로나 작품 폴더를 추측하지 않는다.

## 경로 선택

| 상황 | 진행 경로 |
| --- | --- |
| 일반 사용자 설치 | 영구 보관할 쓰기 가능한 로컬 폴더 → Premiere 정상 종료 → Setup.cmd/Setup.command에서 Codex/Claude Code/Gemini(Antigravity) 선택 → Adobe 설치 확인 → MCP·스킬 자동 등록 → 로컬 프로젝트·시퀀스·패널 열기 → Setup에서 Enter 또는 최초 Connect |
| 소스 개발·수정 | 의도한 루트에서 prepare-only 빌드 → UDT에 그 루트의 apps/uxp-plugin/dist/manifest.json 등록·Load → 연결. prepare-only는 Adobe helper를 설치하지 않음 |
| 이미 연결된 정상 설치 | 현재 owner와 설정 재사용. 새 프로젝트·시퀀스 때문에 재설치·재승인하지 않음 |

CCX와 UDT의 경쟁 복사본을 동시에 로드하지 않는다. 등록 manifest의 절대경로를 확인한다. 일반 CCX 사용자는 UDT Reload 대상이 아니다. Adobe 개발자 모드·보안 설정을 자동 변경하지 않는다.

처음 설치는 패키지 루트의 AI_INSTALL.md를 따른다. Windows 자동화는 installer/bootstrap.ps1 -Client codex -NonInteractive -NoConnect, macOS는 /bin/bash Setup.command --client codex --non-interactive --no-connect를 쓴다. Claude Code는 claude, Gemini(Antigravity)는 gemini, Codex와 Claude Code 둘 다는 both를 선택한다. 전역 Node는 필요 없다. Adobe 동의는 사용자 단계다. 기본 소스 패키지에는 별도 Adobe SDK 바이너리가 없으며 Windows 1차 지원·macOS 실험적 지원과 다른 PC 미검증 상태를 분리한다.

## 설정을 놓을 곳

- PC별 설정: artifacts/settings.json 또는 명시적인 PREMIERE_MCP_CONFIG 파일. version 1, sourceRoots 기본 빈 배열. premiereRoot/graphicsRoot는 자동 발견이 실패할 때 실제 앱·템플릿 위치를 지정한다.
- MCP 등록: Setup이 선택한 Codex, Claude Code 또는 Gemini(Antigravity)의 premiere 항목만 병합한다. Gemini는 ~/.gemini/config/mcp_config.json과 ~/.gemini/config/skills이다. 수동 복구는 artifacts/install/node.json의 Node로 installer/client-registration.mjs --client codex를 preview한 뒤 --apply한다. Claude Code는 --client claude, Gemini는 --client gemini. 기존 다른 서버·설정은 보존하며 unmanaged 충돌은 계획을 읽고 해당 범위 교체가 확인된 경우에만 --replace-client를 사용한다. 백업은 artifacts/client-install-backups에 남는다. Claude Code의 프로젝트/local 정의가 우선할 수 있으므로 claude mcp get premiere와 /mcp로 실제 로드 정의를 확인한다. Antigravity는 MCP Servers에서 premiere를 다시 시작한다(CLI는 /mcp). 작업 공간의 .agents/mcp_config.json에 있는 같은 이름의 항목이 그 작업 공간에서 우선할 수 있다.
- 도구 범위: PREMIERE_MCP_PROFILE. unset은 inspect; edit는 편집, delivery는 공개 저장·닫기·열기·내보내기. Setup은 세 프로필을 생성한다. 실제 tools/list와 비교하고 필요한 범위만 사용한다.
- 프로젝트·시퀀스: get_agent_context의 현재 ID로 지정한다. 미디어 입력은 지원 확장자의 정확한 절대경로로 읽으며 NAS/원본은 읽기 전용이다. 작품별 sourceRoots 등록은 필요 없다.
- 스킬: 정상 Setup은 선택한 클라이언트의 개인 skills 경로에 동봉 네 폴더 전체를 설치한다. 수동/개발 경로는 preview → apply한다. SKILL.md, agents, references를 함께 유지한다. 기존 수정과 충돌하면 비교·백업 후 요청 범위의 교체만 수행한다. 설정·스킬만 복구할 때 Adobe 재설치를 반복하지 않는다.

## 설치 확인

1. 설치 receipt의 INSTALLED, 클라이언트별 PASS·skillCount 4·skillsVerified true와 Connect의 connection.json PASS를 각각 확인한다. FAILED/PREPARED를 설치 완료로 표시하지 않는다. 연결 실패는 설치된 파일과 구분해 표시한다.
2. get_agent_context의 현재 프로젝트·시퀀스와 premiere_ping의 panelVersion·panelMode·localScratchRoot를 현재 패키지 및 설치 루트와 대조한다. 첫 편집 전 recovery 상태를 읽는다.
3. tools/list와 resources/list/read를 확인한다. 스킬 설치 후 목록 갱신·새 대화에서 직접 표현, 바꿔말한 설치 요청, 정상 편집이라는 비대상 요청을 확인한다. 파일 동기화와 실제 모델의 본문 로드를 구분한다.
4. 설치·연결 확인을 위해 사용자 시퀀스를 복제·저장·변경하지 않는다. 정상 편집이 요청됐다면 편집 스킬과 fresh IDs로 이어간다.

적용이 안 되면 [변경 계층별 복구](reload-recovery.md)로 진행한다. 인증 토큰·개인화 sidecar·CCX·runtime 로그는 배포 스킬에 넣지 않는다.
