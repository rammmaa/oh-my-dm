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

Node.js 22 or later and Chrome, Chromium, Brave, or Edge are required. KakaoTalk additionally requires macOS with KakaoTalk installed and signed in.

```bash
npm install
npm run dev -- login instagram
npm run dev
```

For KakaoTalk, grant Accessibility permission to the terminal running oh-my-dm under `System Settings → Privacy & Security → Accessibility`. The app reads only chat content loaded in KakaoTalk's accessibility UI. Conversations and messages are not written to the native bridge or disk.

Instagram login is completed manually in the Chrome window that opens. The default data directory is `~/.oh-my-dm`. Set `OH_MY_DM_BROWSER` if no Chromium-based browser is detected, or use an isolated data directory while developing:

```bash
OH_MY_DM_DATA="$PWD/.oh-my-dm" npm run dev
```

The regular TUI uses Chromium Headless Shell. Use a visible browser only for debugging:

```bash
npm run dev -- --headed
npm run dev -- doctor
npm run dev -- logout instagram
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

oh-my-dm은 **Agent CLI처럼 보이도록 만든 눈치 덜 보이는 TUI 메신저**입니다. Instagram과 카카오톡을 Codex CLI, Claude Code, OpenCode 같은 인터페이스로 표시해, 주변 사람이 화면을 얼핏 봤을 때 일반적인 채팅 앱보다 코딩 에이전트 작업 화면처럼 보이게 합니다.

핵심 목적은 회사, 교실 또는 사람이 함께 있는 공간에서 익숙한 메신저 창을 띄우지 않고 조금 더 몰래 DM을 확인하고 보내는 것입니다. 터미널 작업 흐름을 끊지 않는 것은 그다음 장점입니다. 별도 애플리케이션 백엔드나 메시지 저장소는 없으며, 로컬 connector가 원본 서비스의 데이터를 읽어 하나의 agent-style workspace에 표시합니다.

### 왜 oh-my-dm인가요?

- **메신저처럼 바로 보이지 않는 화면** — 익숙한 DM 창 대신 Agent CLI workspace 형태로 대화를 표시
- **주변 눈치를 덜 보는 메시징** — 화면을 함께 보는 공간에서도 시선을 덜 끌며 DM 확인과 전송
- **터미널 작업 흐름에도 잘 맞는 UI** — Agent CLI 스타일 transcript, command palette, 모델 표기, workspace 경로와 테마
- **DM을 위한 하나의 workspace** — Instagram과 카카오톡 대화를 통합된 TUI에서 탐색
- **로컬 우선·휘발성 구조** — oh-my-dm 서버와 메시지 데이터베이스 없이 동작
- **실제 터미널 입력에 최적화** — 반응형 레이아웃, scrollback, history paging과 한글 IME 지원

### 주요 기능

- 개인 Instagram 계정으로 수동 로그인
- 터미널에서 대화 목록 조회와 텍스트 메시지 송수신
- 그룹 대화의 실제 발신자 이름 표시
- macOS 카카오톡 대화 목록·메시지 조회와 전송
- Instagram/KakaoTalk 통합 대화 목록과 `/connectors` 연결 상태 화면
- 로그인 세션만 전용 브라우저 프로필에 저장
- 대화와 메시지를 저장하지 않고 connector의 원본 데이터를 기준으로 사용
- 시스템 언어에 따라 한국어와 영어를 자동 선택하고 `/language`로 변경

> [!NOTE]
> 현대적인 Agent CLI의 인터페이스에서 영감을 받았지만 OpenAI, Anthropic 또는 OpenCode와 공식적으로 연관되거나 보증받은 프로젝트는 아닙니다. 주변 시선을 줄이기 위한 인터페이스이며 회사 정책이나 기기 모니터링을 우회하는 도구는 아닙니다.

### 요구 사항 및 실행

Node.js 22 이상과 Chrome, Chromium, Brave 또는 Edge가 필요합니다. 카카오톡은 macOS용 앱이 설치되어 있고 로그인되어 있어야 합니다.

```bash
npm install
npm run dev -- login instagram
npm run dev
```

카카오톡을 사용하려면 oh-my-dm을 실행한 터미널 앱을 `시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용`에서 허용하세요. 기본 데이터 디렉터리는 `~/.oh-my-dm`이며 대화나 메시지는 디스크에 저장하지 않습니다.

첫 실행 시 터미널 locale을 기준으로 언어를 자동 선택합니다. `/language auto`, `/language en`, `/language ko`로 바꿀 수 있습니다.

기여 방법과 개발 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md), 보안 제보는 [SECURITY.md](SECURITY.md)를 참고하세요.

### 주의

Instagram DOM selector와 카카오톡 접근성 UI 구조는 서비스 업데이트에 따라 깨질 수 있습니다. Instagram은 명시적 허가 없는 자동화된 정보 수집을 제한하므로 개인 실험 용도로 보수적으로 사용하세요. 대량 전송, 자동 재시도, 우회 기능은 포함하지 않습니다.

## License

[Apache License 2.0](LICENSE)
