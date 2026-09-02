# Architecture

oh-my-dm is a local-only TypeScript/Ink TUI. There is no application backend and no message database.

```text
Instagram web ── DOM/WebSocket wake-up ─┐
                                        ├─ UnifiedChatConnector ─ App (Ink TUI)
KakaoTalk macOS ─ Accessibility/Swift ──┘
```

## Boundaries

- `src/connectors/instagram-web.ts` owns browser lifecycle and DOM reads.
- `src/connectors/kakao-native.ts` owns KakaoTalk state and talks to the persistent Swift bridge.
- `src/connectors/unified.ts` namespaces conversation IDs and presents one connector interface.
- `src/ui/` owns terminal rendering, IME input, themes, models, commands, layout, and localization.
- `src/storage/settings-store.ts` persists non-message UI preferences only.
- `scripts/kakao-bridge.swift` interacts with the KakaoTalk accessibility tree on macOS.

## Data rules

Connectors are the source of truth. Conversation and message content remains in memory and is not persisted by oh-my-dm. The browser profile contains the Instagram login session and must always remain ignored by Git. Settings are written with user-only file permissions.

## Rendering rules

Ink `Static` provides terminal scrollback for the live transcript. History and overflowing command palettes use alternate-screen buffers so they do not duplicate or corrupt the composer/footer. Text layout must account for terminal cell width, multiline content, grapheme clusters, and Korean IME composition.

## Connector constraints

Instagram selectors and KakaoTalk accessibility labels are not stable public APIs. Parsing should accept Korean and English labels where available, degrade safely, and avoid blind retries. Connector changes need sanitized fixtures and focused unit tests.
