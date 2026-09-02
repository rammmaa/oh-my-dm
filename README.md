# oh-my-dm

코딩 에이전트처럼 생긴 로컬 전용 터미널 채팅 클라이언트의 초기 프로토타입입니다.
서버 없이 Instagram 웹과 macOS용 카카오톡을 하나의 TUI에서 다룹니다.

## 현재 범위

- 개인 Instagram 계정으로 수동 로그인
- 대화 목록과 현재 대화의 텍스트를 터미널에 표시
- 그룹방 말풍선의 실제 발신자 이름 표시
- 텍스트 메시지 전송
- macOS 카카오톡 대화 목록·메시지 조회와 전송
- 장기 실행 Swift native bridge를 통한 빠른 카카오 접근성 조회
- Instagram/KakaoTalk 통합 대화 목록과 `/connectors` 연결 상태 화면
- DOM `MutationObserver`와 WebSocket 프레임을 이용한 이벤트 기반 갱신
- 로그인 세션만 전용 브라우저 프로필에 저장
- 대화방과 메시지는 저장하지 않고 실행 중 각 connector의 원본 데이터만 사용
- 선택한 UI 테마 이름만 `settings.json`에 저장

Instagram 내부 WebSocket/MQTT 메시지는 해석하지 않습니다. 프레임 수신을 DOM을 다시 읽는 wake-up 신호로만 사용합니다.

## 실행

Node.js 22 이상과 Chrome, Chromium, Brave 또는 Edge가 필요합니다. 카카오톡을 함께 쓰려면
macOS용 카카오톡이 설치되어 있고 로그인되어 있어야 합니다. 발견되지 않는 브라우저는
`OH_MY_DM_BROWSER` 환경 변수에 Chromium 계열 브라우저의 실행 파일 경로를 지정할 수 있습니다.

```bash
npm install
npm run dev -- login instagram
npm run dev
```

첫 실행 시 macOS가 접근성 권한을 물으면 oh-my-dm을 실행한 터미널 앱을
`시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용`에서 허용해야 합니다. oh-my-dm은
카카오톡을 백그라운드로 실행하고 접근성 UI로 화면에 로드된 대화만 읽습니다.
native bridge 바이너리는 Swift 소스가 변경될 때만 임시 디렉터리에 다시 컴파일되며,
대화방이나 메시지 데이터는 해당 바이너리 또는 디스크에 저장하지 않습니다.

로그인은 열린 Chrome에서 직접 완료합니다. 기본 데이터 디렉터리는 `~/.oh-my-dm`이며, 기존 `~/.oh-my-chat` 로그인 세션과 설정이 있으면 안전하게 그대로 재사용합니다. 개발 중 별도 위치를 사용하려면 다음처럼 지정할 수 있습니다.

```bash
OH_MY_DM_DATA="$PWD/.oh-my-dm" npm run dev
```

일반 TUI는 Dock에 나타나지 않는 Chromium Headless Shell을 사용합니다.
브라우저 화면을 보면서 디버깅하려는 경우에만 다음 옵션을 사용합니다.

```bash
npm run dev -- --headed
```

진단과 로그아웃:

```bash
npm run dev -- doctor
npm run dev -- logout instagram
```

## 주의

DOM selector와 접근성 UI 구조는 Instagram 또는 카카오톡 업데이트에 따라 깨질 수 있습니다.
또한 Instagram은 명시적 허가 없는 자동화된 정보 수집을 제한하므로, 이 프로젝트는 개인
실험 용도로 보수적으로 사용해야 합니다. 대량 전송, 자동 재시도, 우회 기능은 포함하지 않습니다.

## Slash commands

입력창에서 `/`를 입력하면 command palette가 열립니다. 방향키로 선택하고 `Tab`으로 자동완성한 뒤 `Enter`로 실행합니다.

```text
/help
/open <대화방 이름>
/conversations
/unread
/all
/connectors
/theme
/refresh
/clear
/exit
```

`/`로 시작하는 일반 메시지를 보내려면 `//메시지`처럼 입력합니다.
