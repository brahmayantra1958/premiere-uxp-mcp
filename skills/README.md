# 배포 스킬
정본은 이 저장소의 아래 네 폴더다. [bundle manifest](bundle.json)는 파일·resource 경로와 버전을 선언하고 release의 guidance-manifest.json은 실제 SHA-256을 기록한다.

| 스킬 | 역할 |
|---|---|
| [USER-video-edit-premiere](USER-video-edit-premiere/SKILL.md) | 실제 MCP 편집, 기능별 reference 선택 |
| [USER-video-preserve-editability-premiere](USER-video-preserve-editability-premiere/SKILL.md) | 원본 타이밍·사운드·후속 편집 보존 |
| [USER-premiere-connect-recover](USER-premiere-connect-recover/SKILL.md) | 첫 설치·설정, 연결·프로필·배포·Reload·helper·불확실 실행 |
| [USER-computer-use-manage-memory](USER-computer-use-manage-memory/SKILL.md) | 실제 UI 작업 중에만 활성화·정리 |

<a id="install"></a>
## 설치와 업데이트

스킬은 MCP 등록과 별도로 설치한다. Setup 완료 후 설치 루트에서 실행한다. 전역 Node 대신 Setup이 기록한 실행 파일을 사용할 수 있다. 아래 대상 경로는 **현재 클라이언트가 실제 검색하는 개인 skills 경로**로 바꾼다. Codex의 현재 스킬 목록에 나타나는 위치를 확인하고 중복된 다른 경로에 같은 이름을 설치하지 않는다.

Windows PowerShell:

```powershell
$premiereNode = (Get-Content -LiteralPath './artifacts/install/node.json' -Raw | ConvertFrom-Json).executable
$premiereSkills = 'C:/absolute/path/to/your/skills'
& $premiereNode './installer/install-skills.mjs' --target $premiereSkills
& $premiereNode './installer/install-skills.mjs' --target $premiereSkills --apply
```

macOS:

```sh
premiere_node=$(/usr/bin/plutil -extract executable raw -o - ./artifacts/install/node.json)
premiere_skills='/absolute/path/to/your/skills'
"$premiere_node" ./installer/install-skills.mjs --target "$premiere_skills"
"$premiere_node" ./installer/install-skills.mjs --target "$premiere_skills" --apply
```

첫 명령은 변경 계획이다. apply는 선택한 네 폴더만 설치하며 기존 내용을 설치의 artifacts/skill-install-backups에 보존한다.
처음 만나는 다른 내용의 파일은 충돌로 남긴다. 비교 후 교체가 요청된 경우에만 --replace-existing을 명시한다.
관리 manifest의 직전 해시와 다른 로컬 변경도 같은 충돌 규칙을 따른다. 다른 스킬·설정·앱은 수정하지 않는다.
본문과 references 전체를 함께 설치한다. 모든 스킬 링크는 폴더 안에서 해결되며 개발 PC 절대경로에 의존하지 않는다.

설치 후 클라이언트의 스킬 목록을 갱신하고 새 대화에서 네 이름과 description을 확인한다. 설치 경로가 맞아도 이미 시작된 대화의 스킬 목록은 이전 상태일 수 있다. MCP 재연결은 서버 지침 갱신이고 UDT Reload는 패널 갱신이므로 개인 스킬 갱신과 구분한다. 개인 스킬을 지원하지 않는 클라이언트는 `premiere://guide/operate`, `connect-recover`, `setup-checks`, `reload-checks` 등 같은 동봉 문서를 resources/list/read로 읽는다.

## 문서의 역할과 유지보수

| 위치 | 기록할 내용 |
| --- | --- |
| 루트 README | 첫 설치·설정·스킬 설치·연결 확인, 복구 정본의 진입 링크 |
| docs/installation.md | CCX/UDT 설치 경로, 설정 항목, 업데이트·제거의 현재 계약 |
| docs/operator-runbook.md | 증상·증거·조치·성공 기준과 Reload 순서 |
| 복구 SKILL.md | 발동 조건과 짧은 판단 흐름 |
| 복구 references/setup.md·reload-recovery.md | MCP가 끊겨도 사용할 수 있는 이동 가능한 체크와 정본 연결 |
| 코드 주석·MCP 도구 설명 | 프로세스별 설정 수명, sidecar 재생성 이유, 부작용·검증·복구 경계 |

자세한 UI 순서와 버전별 상태는 정본에서 관리하고 진입점에서는 링크한다. 새 reference는 bundle resources에도 등록해 파일 접근이 없는 MCP 클라이언트가 따라갈 수 있게 한다. 과거 장애·실험 기록과 작품 ID는 스킬에 복사하지 않는다.

## 자동 선택 확인

| 요청 예 | 기대 선택 |
| --- | --- |
| Premiere UXP MCP 처음 설치하고 설정해줘 | 연결·복구 |
| 편집 도구가 안 보여 / Reload 했는데 예전 패널이야 | 연결·복구 |
| UDT 창이 실행하자마자 사라져 | 연결·복구 |
| 연결은 정상이고 선택한 클립 Scale만 바꿔줘 | 편집; 복구 흐름 시작하지 않음 |
| 원본 컷과 사운드를 보존해서 세로로 재구도해줘 | 편집 + 편집 가능성 보존 |
| Premiere와 무관한 앱 설치 | 이 번들의 스킬을 발동하지 않음 |

이 표는 평가 기대값이다. 실제 모델 실행에서 선택한 스킬명, 본문/reference 읽기, 필요한 도구 호출을 별도로 확인한다. 이름 선택만 확인한 실행은 본문 자동 로드까지 PASS로 올리지 않는다.

## agent-orchestrator

정본 record의 body/trigger와 sync.name/metadata/resources를 함께 갱신한다. renderer가 생성한 SKILL.md와 리소스 내용으로 대조한다.
기존 분류·harness·ID를 보존하며 unrelated skills를 다시 작성하지 않는다. 범위 지정 동기화와 공식 mutex/백업/rollback 경로를 사용한다.
Codex와 동기화할 때 대상 설정으로 Claude 등 요청하지 않은 설치를 제외한다. 설치본의 독립 수정은 정본에 반영하거나 명시적으로 충돌 해결한 뒤 적용한다.
renderer의 분류 꼬리말은 설치 의미가 보존되는 메타데이터다. 본문·frontmatter·리소스의 일치와 실제 파일 해시를 각각 검증한다.

## 검증

npm run guidance:check는 이름/frontmatter, 내부 링크, 공개 문서 경로, 개인경로 배제와 bundle 완전성을 검사한다.
npm run package:release는 검증 후 실제 ZIP에 스킬·문서·해시 manifest·이동 가능한 AGENTS를 넣는다.
예제는 연결 스키마로 검사하지만 실행하지 않는다. 자동 선택은 직접/바꿔말한/비대상 사례를 별도로 평가한다.
파일/프로토콜 테스트는 실제 Premiere 편집·모델 자동 선택 품질을 대신하지 않는다.
USER- 이름은 사용자 규약이며 디렉터리/frontmatter/sync.name을 동일하게 유지한다.
