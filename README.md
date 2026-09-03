# oh-my-dm

[English](#english) · [한국어](#한국어)

## English

**DM without looking like you're DMing.**

oh-my-dm is a discreet TUI messenger styled to look like an Agent CLI. It brings Instagram and KakaoTalk into an interface inspired by tools such as Codex CLI, Claude Code, and OpenCode, making casual screen glances look more like coding-agent work than an open chat app.

The main goal is simple: let you check and send DMs more privately in shared offices, classrooms, or other places where a familiar messenger window would immediately draw attention. Staying inside your terminal workflow is an additional benefit. There is no application backend or message archive; local connectors read from the original services and present everything through one agent-style workspace.

### Why oh-my-dm?

- **Doesn't immediately look like a messenger** — conversations are presented as an Agent CLI workspace instead of a familiar DM window
- **Designed for discreet messaging** — check and send DMs with less visual attention from people around you
- **Also fits your terminal workflow** — use an agent-style transcript, command palette, model label, workspace path, themes, and keyboard-first navigation
- **One workspace for DMs** — browse Instagram and KakaoTalk conversations through a unified TUI
- **Local-first and ephemeral** — no oh-my-dm server and no persisted message database
- **Built for real terminal input** — responsive layouts, scrollback, history paging, and Korean IME support

### Features

- Sign in manually with a personal Instagram account
- Browse conversations and exchange text messages from the terminal
- See actual sender names in group conversations
- Browse and send KakaoTalk messages on macOS
- Use one unified conversation list and inspect connections with `/connectors`
- Receive event-driven updates through DOM and WebSocket wake-up signals
- Keep only the login session in a dedicated browser profile
- Never persist conversations or messages; connectors remain the source of truth
- Automatically use Korean on Korean systems and English elsewhere
- Change the interface language at any time with `/language`

oh-my-dm does not decode Instagram's internal WebSocket or MQTT payloads. Incoming frames are used only as wake-up signals to read the visible DOM again.

> [!NOTE]
> The interface is inspired by modern Agent CLI tools, but oh-my-dm is not affiliated with or endorsed by OpenAI, Anthropic, or OpenCode. It is a privacy-oriented interface, not a tool for bypassing workplace policies or device monitoring.

### Requirements and setup

Node.js 22 or later is required. The Instagram connector installs and uses its own Playwright Chromium, so it works independently of whether your default browser is Safari, Chrome, Brave, or another browser. KakaoTalk additionally requires macOS with KakaoTalk installed and signed in.

```bash
npm install --global oh-my-dm
oh-my-dm login instagram
oh-my-dm
```

If npm reports that the `oh-my-dm` install script was blocked, allow it and reinstall so the dedicated Chromium can be downloaded:

```bash
npm install --global --allow-scripts=oh-my-dm oh-my-dm
```

`dm` is installed as a shorter alias, so you can launch the same TUI from any directory with either `dm` or `oh-my-dm`.

If typing `oh-my-dm` changes into a local directory with that name instead of launching the TUI, the global command is not installed in the current shell. Install it with the command above, then open a new terminal or run `rehash` in zsh.

For KakaoTalk, grant Accessibility permission to the terminal running oh-my-dm under `System Settings → Privacy & Security → Accessibility`. The app reads only chat content loaded in KakaoTalk's accessibility UI. Conversations and messages are not written to the native bridge or disk.

Instagram login is completed manually in the dedicated Playwright Chromium window that opens. The same isolated profile is reused headlessly by the TUI; your default browser profile and cookies are never accessed. The default data directory is `~/.oh-my-dm`. Developers can override the Chromium executable with `OH_MY_DM_BROWSER`, or use an isolated data directory:

```bash
OH_MY_DM_DATA="$PWD/.oh-my-dm" npm run dev
```

The regular TUI runs the bundled Playwright Chromium headlessly. Use a visible browser only for debugging:

```bash
oh-my-dm --headed
oh-my-dm doctor
oh-my-dm logout instagram
```

### Language

The interface follows `LC_ALL`, `LC_MESSAGES`, or `LANG` by default. A manual choice is saved locally.

```text
/language auto
/language en
/language ko
```

### Slash commands

Type `/` to open the command palette. Navigate with arrow keys, press `Tab` to autocomplete, and press `Enter` to run a command.

```text
/help
/open <conversation name>
/conversations
/unread
/all
/connectors
/history
/model
/theme
/language [auto|ko|en]
/refresh
/clear
/exit
```

To send a regular message beginning with `/`, type it with two slashes, such as `//message`.

### Important

Instagram DOM selectors and KakaoTalk accessibility UI structures can change without notice and may break the connectors. Instagram also restricts unauthorized automated data collection. Use this project conservatively for personal experimentation. Bulk messaging, automatic retries, and bypass mechanisms are intentionally excluded.

### Contributing and releases

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. This project uses Conventional Commits, automated checks, and Release Please. Security reports should follow [SECURITY.md](SECURITY.md), not public issues.

## 한국어

**DM 하는 것처럼 보이지 않게 DM하세요.**

oh-my-dm은 Agent CLI처럼 보이도록 만든 눈치 덜 보이는 TUI 메신저입니다. Instagram과 카카오톡을 Codex CLI, Claude Code, OpenCode 같은 도구에서 영감을 받은 인터페이스로 표시해, 주변 사람이 화면을 얼핏 봤을 때 열린 채팅 앱보다 코딩 에이전트 작업처럼 보이게 합니다.

핵심 목적은 회사, 교실 또는 사람이 함께 있는 공간에서 익숙한 메신저 창으로 시선을 끌지 않고 조금 더 사적으로 DM을 확인하고 보내는 것입니다. 터미널 작업 흐름을 유지하는 것은 추가 장점입니다. 별도 애플리케이션 백엔드나 메시지 저장소는 없으며, 로컬 connector가 원본 서비스의 데이터를 읽어 하나의 Agent 스타일 workspace에 표시합니다.

### 왜 oh-my-dm인가요?

- **메신저처럼 바로 보이지 않는 화면** — 익숙한 DM 창 대신 Agent CLI workspace 형태로 대화를 표시
- **주변 눈치를 덜 보는 메시징** — 주변 사람의 시선을 덜 끌며 DM을 확인하고 전송하도록 설계
- **터미널 작업 흐름에도 잘 맞는 UI** — Agent 스타일 transcript, command palette, 모델 표기, workspace 경로, 테마와 키보드 중심 탐색
- **DM을 위한 하나의 workspace** — Instagram과 카카오톡 대화를 통합된 TUI에서 탐색
- **로컬 우선·휘발성 구조** — oh-my-dm 서버와 영구 메시지 데이터베이스 없이 동작
- **실제 터미널 입력에 최적화** — 반응형 레이아웃, scrollback, history paging과 한글 IME 지원

### 주요 기능

- 개인 Instagram 계정으로 수동 로그인
- 터미널에서 대화 목록 조회와 텍스트 메시지 송수신
- 그룹 대화의 실제 발신자 이름 표시
- macOS 카카오톡 대화 목록·메시지 조회와 전송
- 하나의 통합 대화 목록 사용 및 `/connectors`에서 연결 상태 확인
- DOM과 WebSocket wake-up signal을 통한 event-driven 업데이트
- 로그인 세션만 전용 브라우저 프로필에 저장
- 대화와 메시지는 저장하지 않으며 connector를 원본 데이터 기준으로 사용
- 한국어 시스템에서는 한국어, 그 외에는 영어를 자동 사용하고 언제든 `/language`로 변경

oh-my-dm은 Instagram 내부 WebSocket이나 MQTT payload를 해석하지 않습니다. 수신 frame은 화면에 표시된 DOM을 다시 읽도록 깨우는 신호로만 사용합니다.

> [!NOTE]
> 현대적인 Agent CLI의 인터페이스에서 영감을 받았지만 OpenAI, Anthropic 또는 OpenCode와 공식적으로 연관되거나 보증받은 프로젝트는 아닙니다. 주변 시선을 줄이기 위한 인터페이스이며 회사 정책이나 기기 모니터링을 우회하는 도구는 아닙니다.

### 요구 사항 및 설정

Node.js 22 이상이 필요합니다. Instagram connector는 전용 Playwright Chromium을 설치해 사용하므로 기본 브라우저가 Safari, Chrome, Brave 또는 다른 브라우저여도 동일하게 작동합니다. 카카오톡은 macOS용 앱이 설치되어 있고 로그인되어 있어야 합니다.

```bash
npm install --global oh-my-dm
oh-my-dm login instagram
oh-my-dm
```

npm이 `oh-my-dm` 설치 스크립트를 차단했다고 표시하면, 전용 Chromium을 내려받을 수 있도록 스크립트를 허용해 다시 설치하세요.

```bash
npm install --global --allow-scripts=oh-my-dm oh-my-dm
```

짧은 별칭인 `dm`도 함께 설치되므로 어느 경로에서든 `dm` 또는 `oh-my-dm`으로 같은 TUI를 실행할 수 있습니다.

`oh-my-dm`을 입력했는데 TUI가 실행되지 않고 같은 이름의 로컬 폴더로 이동한다면 현재 shell에 전역 명령이 설치되지 않은 상태입니다. 위 명령으로 설치한 뒤 새 터미널을 열거나 zsh에서 `rehash`를 실행하세요.

카카오톡을 사용하려면 oh-my-dm을 실행한 터미널 앱을 `시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용`에서 허용하세요. 앱은 카카오톡 손쉬운 사용 UI에 불러온 채팅 내용만 읽으며, native bridge나 디스크에 대화와 메시지를 기록하지 않습니다.

Instagram 로그인은 열리는 전용 Playwright Chromium 창에서 직접 완료합니다. TUI는 같은 격리 프로필을 headless로 재사용하며 사용자의 기본 브라우저 프로필이나 쿠키에는 접근하지 않습니다. 기본 데이터 디렉터리는 `~/.oh-my-dm`입니다. 개발자는 `OH_MY_DM_BROWSER`로 Chromium 실행 파일을 변경하거나 별도의 데이터 디렉터리를 사용할 수 있습니다.

```bash
OH_MY_DM_DATA="$PWD/.oh-my-dm" npm run dev
```

일반 TUI는 번들된 Playwright Chromium을 headless로 사용합니다. 디버깅할 때만 브라우저 창을 표시하세요.

```bash
oh-my-dm --headed
oh-my-dm doctor
oh-my-dm logout instagram
```

### 언어

기본적으로 `LC_ALL`, `LC_MESSAGES`, `LANG`을 따라 UI 언어를 선택하며, 수동 선택은 로컬에 저장됩니다.

```text
/language auto
/language en
/language ko
```

### 슬래시 명령

`/`를 입력해 command palette를 엽니다. 방향키로 이동하고 `Tab`으로 자동 완성한 뒤 `Enter`로 실행합니다.

```text
/help
/open <대화방 이름>
/conversations
/unread
/all
/connectors
/history
/model
/theme
/language [auto|ko|en]
/refresh
/clear
/exit
```

`/`로 시작하는 일반 메시지를 보내려면 `//message`처럼 slash를 두 번 입력하세요.

### 주의

Instagram DOM selector와 카카오톡 손쉬운 사용 UI 구조는 예고 없이 변경되어 connector가 깨질 수 있습니다. Instagram은 허가받지 않은 자동 데이터 수집도 제한합니다. 개인 실험 용도로 보수적으로 사용하세요. 대량 전송, 자동 재시도와 우회 기능은 의도적으로 포함하지 않습니다.

### 기여 및 릴리스

Pull request를 열기 전에 [CONTRIBUTING.md](CONTRIBUTING.md)를 읽어주세요. 이 프로젝트는 Conventional Commits, 자동 검사와 Release Please를 사용합니다. 보안 문제는 공개 issue 대신 [SECURITY.md](SECURITY.md)의 절차에 따라 제보해주세요.

## License

[Apache License 2.0](LICENSE)
