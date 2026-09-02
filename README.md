# oh-my-dm

[English](#english) · [한국어](#한국어)

## English

A local-first terminal chat client that looks and feels like a coding agent. Use Instagram and KakaoTalk from one TUI without running a backend server.

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

코딩 에이전트처럼 생긴 로컬 우선 터미널 채팅 클라이언트입니다. 별도 백엔드 서버 없이 Instagram 웹과 macOS용 카카오톡을 하나의 TUI에서 다룹니다.

### 주요 기능

- 개인 Instagram 계정으로 수동 로그인
- 터미널에서 대화 목록 조회와 텍스트 메시지 송수신
- 그룹 대화의 실제 발신자 이름 표시
- macOS 카카오톡 대화 목록·메시지 조회와 전송
- Instagram/KakaoTalk 통합 대화 목록과 `/connectors` 연결 상태 화면
- 로그인 세션만 전용 브라우저 프로필에 저장
- 대화와 메시지를 저장하지 않고 connector의 원본 데이터를 기준으로 사용
- 시스템 언어에 따라 한국어와 영어를 자동 선택하고 `/language`로 변경

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
