# Contributing to oh-my-dm

[English](#english) · [한국어](#한국어)

## English

Thanks for helping improve oh-my-dm. Small, focused changes with tests are the easiest to review.

### Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use a GitHub issue for bugs and feature proposals. For small documentation fixes, a pull request is enough.
- Do not report security vulnerabilities in a public issue; follow [SECURITY.md](SECURITY.md).
- Never include cookies, browser profiles, chat content, screenshots containing personal information, or KakaoTalk accessibility dumps.

### Local development

Requirements: Node.js 22+, npm, and a Chromium-based browser. KakaoTalk development requires macOS.

```bash
git clone git@github.com:stacking-money-forever/oh-my-dm.git
cd oh-my-dm
npm ci
npm test
npm run typecheck
npm run build
```

Use an isolated profile for manual connector testing:

```bash
OH_MY_DM_DATA="$PWD/.oh-my-dm" npm run dev
```

The `.oh-my-dm/` directory is ignored. Do not force-add it.

### Branches and commits

- Branch from the latest `main`.
- Use short branch names such as `feat/language-picker`, `fix/kakao-timeout`, or `docs/setup`.
- Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `perf:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, or `chore:`.
- Add `!` or a `BREAKING CHANGE:` footer for incompatible behavior.
- Keep refactors separate from behavior changes when practical.

Examples:

```text
feat: add English interface
fix(kakao): preserve message order while paging
docs: explain Accessibility permissions
```

### Code conventions

- Use TypeScript with strict type checking and ESM imports ending in `.js`.
- Prefer small pure functions for parsing, layout, and state transitions.
- Keep connector-specific behavior inside `src/connectors/`.
- Keep user-facing strings in the i18n layer; do not add inline Korean- or English-only UI copy.
- Preserve terminal width handling, Korean IME behavior, and grapheme-safe cursor movement.
- Do not persist message or conversation content.
- Avoid aggressive retries, bulk messaging, anti-detection, or bypass behavior.
- Add or update `node:test` coverage for observable behavior.

### Pull request checklist

Before opening a pull request, run:

```bash
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

Complete the pull request template, link the issue, explain manual testing, and include terminal screenshots only after removing private data. A maintainer may ask that a large proposal be split into smaller pull requests.

### Review and release

Pull requests require passing CI and review. Squash-merge with a Conventional Commit title. Release Please collects merged commits into a release pull request, updates the version and changelog, and creates a GitHub release when that pull request is merged. The release workflow then publishes the package to npm.

## 한국어

oh-my-dm에 기여해 주셔서 감사합니다. 변경 범위를 작게 유지하고 테스트를 함께 추가하면 빠르게 검토할 수 있습니다.

- 작업 전 기존 issue와 PR을 검색해 주세요.
- 보안 취약점은 공개 issue 대신 [SECURITY.md](SECURITY.md)의 방법으로 제보해 주세요.
- 쿠키, 브라우저 프로필, 실제 대화, 개인정보가 포함된 스크린샷이나 접근성 덤프를 올리지 마세요.
- 최신 `main`에서 `feat/...`, `fix/...`, `docs/...` 형태의 브랜치를 만드세요.
- 커밋과 PR 제목은 Conventional Commits 형식(`feat:`, `fix:`, `docs:` 등)을 사용하세요.
- 사용자에게 보이는 문구는 i18n 계층에 한국어와 영어를 함께 추가하세요.
- 대화방과 메시지 내용을 저장하는 기능, 대량 전송, 우회 기능은 받지 않습니다.
- PR 전 `npm test`, `npm run typecheck`, `npm run build`, `npm pack --dry-run`을 실행하세요.

KakaoTalk 관련 개발과 수동 검증은 macOS가 필요합니다. 실제 계정으로 테스트할 때는 `OH_MY_DM_DATA="$PWD/.oh-my-dm"`처럼 격리된 프로필을 사용하세요.
