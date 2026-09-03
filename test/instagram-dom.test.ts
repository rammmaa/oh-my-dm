import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeConversation,
  inheritGroupedSenders,
  mergeLoadedConversations,
  mergeMessageWindows,
  normalizeMessage,
  normalizeSenderLabel,
  restoreTransientConversationGaps,
  stabilizeButtonConversationIds,
  threadIdFromHref,
} from "../src/connectors/instagram-dom.js";

test("thread id를 Instagram DM URL에서 추출한다", () => {
  assert.equal(threadIdFromHref("/direct/t/123456789/"), "123456789");
  assert.equal(threadIdFromHref("https://instagram.com/direct/t/abc?x=1"), "abc");
  assert.equal(threadIdFromHref("/explore/"), undefined);
  assert.equal(threadIdFromHref("button:3"), "button:3");
});

test("대화 링크를 정규화한다", () => {
  assert.deepEqual(
    normalizeConversation({
      href: "/direct/t/42/",
      text: "Alice\n오늘 보자\n오늘 보자",
      ariaLabel: "읽지 않은 새 메시지",
    }),
    {
      id: "42",
      href: "/direct/t/42/",
      title: "Alice",
      preview: "오늘 보자",
      unread: true,
    },
  );
});

test("버튼 기반 대화방은 위치가 바뀌어도 제목별 안정 ID를 사용한다", () => {
  const conversations = [
    { id: "button:0", href: "button:0", title: "김태현님", unread: false },
    { id: "button:1", href: "button:1", title: "김태현님", unread: false },
    { id: "button:2", href: "button:2", title: "박가은님", unread: false },
  ];
  const shifted = stabilizeButtonConversationIds(conversations);

  assert.notEqual(shifted[0]?.id, shifted[1]?.id);
  assert.match(shifted[2]?.id ?? "", /^button-thread:/);
  assert.equal(shifted[2]?.href, "button:2");
});

test("표시 이름이 같은 서로 다른 Instagram 계정을 프로필 식별자로 구분한다", () => {
  const firstWindow = stabilizeButtonConversationIds([
    normalizeConversation({
      href: "button:3",
      text: "김태현님\n첫 번째 대화",
      identity: "/profile/first-account.jpg",
    }),
    normalizeConversation({
      href: "button:4",
      text: "김태현님\n두 번째 대화",
      identity: "/profile/second-account.jpg",
    }),
  ].filter((item): item is NonNullable<typeof item> => item !== undefined));
  const shiftedWindow = stabilizeButtonConversationIds([
    normalizeConversation({
      href: "button:0",
      text: "김태현님\n두 번째 대화",
      identity: "/profile/second-account.jpg",
    }),
  ].filter((item): item is NonNullable<typeof item> => item !== undefined), firstWindow);

  assert.notEqual(firstWindow[0]?.id, firstWindow[1]?.id);
  assert.equal(firstWindow[1]?.id, shiftedWindow[0]?.id);
  assert.deepEqual(
    mergeLoadedConversations(firstWindow, shiftedWindow).map((item) => item.id),
    firstWindow.map((item) => item.id),
  );
});

test("임시 식별자에서 실제 thread 식별자로 바뀌어도 같은 이름의 두 계정 ID를 승계한다", () => {
  const initial = stabilizeButtonConversationIds([
    { id: "button:0", href: "button:0", identity: "placeholder", title: "김태현님", preview: "첫 대화", unread: false },
    { id: "button:1", href: "button:1", identity: "placeholder", title: "김태현님", preview: "둘째 대화", unread: false },
  ]);
  const loaded = stabilizeButtonConversationIds([
    { id: "button:0", href: "button:0", identity: "thread:111", title: "김태현님", preview: "첫 대화", unread: false },
    { id: "button:1", href: "button:1", identity: "thread:222", title: "김태현님", preview: "둘째 대화", unread: false },
  ], initial);

  assert.notEqual(initial[0]?.id, initial[1]?.id);
  assert.deepEqual(loaded.map((item) => item.id), initial.map((item) => item.id));
  assert.deepEqual(loaded.map((item) => item.identity), ["thread:111", "thread:222"]);
});

test("가상화된 새 행이 기존 방의 stale thread ID를 달아도 기존 방을 덮어쓰지 않는다", () => {
  const existing = stabilizeButtonConversationIds([
    { id: "button:0", href: "button:0", identity: "thread:bang", title: "방세준님", preview: "반응", unread: false },
  ]);
  const recycled = stabilizeButtonConversationIds([
    { id: "button:1", href: "button:1", identity: "thread:bang", title: "s0meri님", preview: "걸어줘", unread: false },
  ], existing);
  const merged = mergeLoadedConversations(existing, recycled);

  assert.notEqual(recycled[0]?.id, existing[0]?.id);
  assert.deepEqual(merged.map((item) => item.title), ["방세준님", "s0meri님"]);
  assert.deepEqual(merged.map((item) => item.preview), ["반응", "걸어줘"]);
});

test("커넥터 병합 중 사라진 Instagram 중간 가상화 행을 복원한다", () => {
  const row = (id: string, title: string) => ({ id, href: `button:${id}`, title, unread: false });
  const previous = [
    row("a", "김태현 1"),
    row("b", "김태현 2"),
    row("c", "박가은"),
    row("d", "방세준"),
  ];
  const current = [previous[0]!, previous[1]!, previous[3]!];

  assert.deepEqual(
    restoreTransientConversationGaps(previous, current).map((item) => item.title),
    ["김태현 1", "김태현 2", "박가은", "방세준"],
  );
});

test("Instagram DOM이 기존 목록의 일부만 가상화해도 앞뒤 항목과 순서를 유지한다", () => {
  const row = (id: string) => ({ id, href: `button:${id}`, title: id, unread: false });
  const previous = [row("a"), row("b"), row("c"), row("d")];
  const current = [{ ...previous[0]!, preview: "updated" }, previous[1]!];

  const restored = restoreTransientConversationGaps(previous, current);
  assert.deepEqual(restored.map((item) => item.id), ["a", "b", "c", "d"]);
  assert.equal(restored[0]?.preview, "updated");
});

test("아래로 불러온 Instagram 대화방을 기존 목록 뒤에 유지한다", () => {
  const row = (id: string, preview = id) => ({
    id,
    href: `button:${id}`,
    title: id,
    preview,
    unread: false,
  });
  const existing = [row("a"), row("b")];
  const incoming = [row("b", "updated"), row("c")];

  const merged = mergeLoadedConversations(existing, incoming);
  assert.deepEqual(merged.map((item) => item.id), ["a", "b", "c"]);
  assert.equal(merged[1]?.preview, "updated");
});

test("메시지 fingerprint가 안정적이다", () => {
  const raw = { text: "hello", ariaLabel: "Alice, message", timestamp: "2026-09-01" };
  const first = normalizeMessage("42", raw, 0);
  const second = normalizeMessage("42", raw, 0);
  assert.equal(first?.id, second?.id);
  assert.equal(first?.sender, "Alice");
});

test("DOM에서 찾은 실제 발신자 이름을 우선한다", () => {
  const message = normalizeMessage(
    "group-1",
    { text: "안녕하세요", sender: "이정민", ariaLabel: "fallback, message" },
    0,
  );
  assert.equal(message?.sender, "이정민");
});

test("Instagram 프로필과 메시지 라벨에서 발신자 이름만 추출한다", () => {
  assert.equal(normalizeSenderLabel("임규현님의 프로필 사진"), "임규현");
  assert.equal(normalizeSenderLabel("이정민님이 보낸 메시지"), "이정민");
  assert.equal(normalizeSenderLabel("Alice's profile picture"), "Alice");
  assert.equal(normalizeSenderLabel("Open the profile page of x0gu.s_board"), "x0gu.s_board");
  assert.equal(normalizeSenderLabel("김태현님의 프로필 페이지 열기"), "김태현");
  assert.equal(normalizeSenderLabel("이정민 replied to you"), "이정민");
});

test("프로필 이미지 라벨을 정규화해 메시지 발신자로 사용한다", () => {
  const message = normalizeMessage(
    "group-1",
    { text: "어디가심?", sender: "이정민님의 프로필 사진" },
    0,
  );
  assert.equal(message?.sender, "이정민");
});

test("위로 불러온 메시지를 기존 대화 앞에 겹침 없이 합친다", () => {
  const message = (id: string, sender = "A") => ({
    id,
    threadId: "group-1",
    sender,
    text: id,
  });
  const existing = [message("3"), message("4"), message("5")];
  const older = [message("1"), message("2"), message("3")];
  assert.deepEqual(
    mergeMessageWindows(existing, older, "older").map((item) => item.text),
    ["1", "2", "3", "4", "5"],
  );
});

test("현재 창과 같은 메시지는 기록에 중복 추가하지 않는다", () => {
  const message = (id: string) => ({ id, threadId: "group-1", sender: "A", text: id });
  const existing = [message("1"), message("2"), message("3")];
  assert.deepEqual(
    mergeMessageWindows(existing, existing.slice(1), "newer").map((item) => item.text),
    ["1", "2", "3"],
  );
});

test("같은 사람이 연속해서 보낸 메시지의 unknown을 직전 이름으로 채운다", () => {
  const base = { threadId: "group-1" };
  const messages = inheritGroupedSenders([
    { ...base, id: "1", sender: "임규현", text: "지금 플렉스 ㄱㄱ" },
    { ...base, id: "2", sender: "unknown", text: "바로뽑아줌 서류" },
  ]);
  assert.equal(messages[1]?.sender, "임규현");
});

test("Instagram이 묶음 마지막에만 프로필을 붙여도 앞 메시지의 이름을 채운다", () => {
  const base = { threadId: "thread-1", timestamp: undefined };
  const messages = inheritGroupedSenders([
    { ...base, id: "1", sender: "나", text: "축구 안 할 거임?" },
    { ...base, id: "2", sender: "unknown", text: "축구화 안 들고 왔음" },
    { ...base, id: "3", sender: "unknown", text: "보드를 받아서" },
    { ...base, id: "4", sender: "x0gu.s_board", text: "보드나 탈 거임" },
  ]);

  assert.deepEqual(messages.map((message) => message.sender), [
    "나",
    "x0gu.s_board",
    "x0gu.s_board",
    "x0gu.s_board",
  ]);
});

test("새 DOM에서 찾은 이름으로 메모리의 unknown 메시지를 갱신한다", () => {
  const unknown = { id: "old", threadId: "group-1", sender: "unknown", text: "바로뽑아줌" };
  const resolved = { ...unknown, id: "new", sender: "임규현" };
  const merged = mergeMessageWindows([unknown], [resolved], "newer");
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.sender, "임규현");
});
