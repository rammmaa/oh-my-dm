import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeConversation,
  inheritGroupedSenders,
  mergeLoadedConversations,
  mergeMessageWindows,
  normalizeMessage,
  normalizeSenderLabel,
  repairReplyQuoteSenders,
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
  assert.equal(message?.kind, "text");
});

test("메시지 타입과 답장 메타데이터를 정규화한다", () => {
  const image = normalizeMessage(
    "group-1",
    { text: "사진을 보냈습니다.", sender: "이정민" },
    0,
  );
  const reply = normalizeMessage(
    "group-1",
    { text: "괜찮은데?", sender: "이정민 replied to 故추whw만함" },
    1,
  );

  assert.equal(image?.kind, "image");
  assert.equal(reply?.kind, "reply");
  assert.deepEqual(reply?.replyTo, { sender: "故추whw만함" });
  assert.equal(reply?.sender, "이정민");
});

test("내용이 같아도 타입이 다른 메시지는 병합 중 사라지지 않는다", () => {
  const base = { threadId: "group-1", sender: "A", text: "공유됨" };
  const existing = [{ ...base, id: "text", kind: "text" as const }];
  const incoming = [{ ...base, id: "post", kind: "post" as const }];

  assert.deepEqual(
    mergeMessageWindows(existing, incoming, "newer").map((message) => message.kind),
    ["text", "post"],
  );
});

test("Instagram 프로필과 메시지 라벨에서 발신자 이름만 추출한다", () => {
  assert.equal(normalizeSenderLabel("임규현님의 프로필 사진"), "임규현");
  assert.equal(normalizeSenderLabel("이정민님이 보낸 메시지"), "이정민");
  assert.equal(normalizeSenderLabel("Alice's profile picture"), "Alice");
  assert.equal(normalizeSenderLabel("Open the profile page of x0gu.s_board"), "x0gu.s_board");
  assert.equal(normalizeSenderLabel("김태현님의 프로필 페이지 열기"), "김태현");
  assert.equal(normalizeSenderLabel("이정민 replied to you"), "이정민");
  assert.equal(normalizeSenderLabel("이정민 replied to 故추whw만함"), "이정민");
  assert.equal(normalizeSenderLabel("이정민님이 故추whw만함님에게 보낸 답장"), "이정민");
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
    kind: "text" as const,
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

test("Instagram DOM이 최근 anchor 뒤에 과거 행을 붙여도 과거 데이터는 앞에 병합한다", () => {
  const message = (text: string) => ({
    id: text,
    threadId: "group-1",
    kind: "text" as const,
    sender: "A",
    text,
  });
  const existing = [message("최근 1"), message("최근 2"), message("최신")];
  const mixedDomWindow = [
    message("최근 2"),
    message("최신"),
    message("과거 1"),
    message("과거 2"),
  ];

  assert.deepEqual(
    mergeMessageWindows(existing, mixedDomWindow, "older").map((item) => item.text),
    ["과거 1", "과거 2", "최근 1", "최근 2", "최신"],
  );
});

test("전체 최근 창 뒤에 과거 행이 붙은 DOM도 anchor 아래 순서를 오염시키지 않는다", () => {
  const message = (text: string) => ({
    id: text,
    threadId: "group-1",
    kind: "text" as const,
    sender: "A",
    text,
  });
  const existing = [message("최근 1"), message("최근 2"), message("최신")];
  const mixedDomWindow = [...existing, message("과거 1"), message("과거 2")];

  assert.deepEqual(
    mergeMessageWindows(existing, mixedDomWindow, "older").map((item) => item.text),
    ["과거 1", "과거 2", "최근 1", "최근 2", "최신"],
  );
});

test("여러 번의 sparse 과거 DOM 병합에서도 기존 history 순서를 고정한다", () => {
  const message = (text: string) => ({
    id: text,
    threadId: "group-1",
    kind: "text" as const,
    sender: "A",
    text,
  });
  const recent = ["릴스", "퐁당퐁당", "탐구", "개추", "잘하네", "24322", "캬"]
    .map(message);
  const firstLoad = mergeMessageWindows(
    recent,
    [message("24322"), message("캬"), message("서울남자"), message("ㅋㅋㅋ")],
    "older",
  );
  const secondLoad = mergeMessageWindows(
    firstLoad,
    [message("탐구"), message("잘하네"), message("더 오래된 메시지")],
    "older",
  );

  assert.deepEqual(secondLoad.map((item) => item.text), [
    "더 오래된 메시지",
    "서울남자",
    "ㅋㅋㅋ",
    "릴스",
    "퐁당퐁당",
    "탐구",
    "개추",
    "잘하네",
    "24322",
    "캬",
  ]);
});

test("본문이 실제로 두 번 전송된 경우 occurrence 수를 보존한다", () => {
  const message = (id: string) => ({
    id,
    threadId: "group-1",
    kind: "text" as const,
    sender: "A",
    text: "아니지",
  });

  const merged = mergeMessageWindows([message("new")], [message("old"), message("new")], "older");
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((item) => item.text), ["아니지", "아니지"]);
});

test("답장 메타데이터가 조회마다 달라도 같은 anchor로 병합하고 정보를 보강한다", () => {
  const plain = {
    id: "plain",
    threadId: "group-1",
    kind: "text" as const,
    sender: "polalmkhksohn_",
    text: "집갔는데 문잠겨있다 이제",
  };
  const reply = {
    ...plain,
    id: "reply",
    kind: "reply" as const,
    replyTo: { sender: "임규현" },
  };

  const merged = mergeMessageWindows([plain], [reply], "older");
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.kind, "reply");
  assert.deepEqual(merged[0]?.replyTo, { sender: "임규현" });
});

test("같은 본문의 일반 메시지와 답장을 anchor 사이의 실제 순서대로 병합한다", () => {
  const base = { threadId: "group-1", sender: "polalmkhksohn_", timestamp: undefined };
  const existing = [
    { ...base, id: "taxi", kind: "text" as const, text: "택시비 시팣" },
    { ...base, id: "plain", kind: "text" as const, text: "아니지" },
    { ...base, id: "smoke", kind: "text" as const, text: "담배걸린거아니다" },
    { ...base, id: "reel", kind: "reel" as const, text: "(릴스)" },
  ];
  const incoming = [
    { ...base, id: "older", kind: "text" as const, sender: "이정민", text: "아이고" },
    { ...base, id: "taxi-new", kind: "text" as const, text: "택시비 시팣" },
    {
      ...base,
      id: "reply",
      kind: "reply" as const,
      text: "아니지",
      replyTo: { sender: "임규현", text: "집갔는데 문잠겨있다 이제" },
    },
    { ...base, id: "plain-new", kind: "text" as const, text: "아니지" },
    { ...base, id: "smoke-new", kind: "text" as const, text: "담배걸린거아니다" },
    { ...base, id: "reel-new", kind: "reel" as const, text: "(릴스)" },
  ];

  const merged = mergeMessageWindows(existing, incoming, "older");
  assert.deepEqual(
    merged.map(({ kind, text }) => ({ kind, text })),
    [
      { kind: "text", text: "아이고" },
      { kind: "text", text: "택시비 시팣" },
      { kind: "reply", text: "아니지" },
      { kind: "text", text: "아니지" },
      { kind: "text", text: "담배걸린거아니다" },
      { kind: "reel", text: "(릴스)" },
    ],
  );
});

test("현재 창과 같은 메시지는 기록에 중복 추가하지 않는다", () => {
  const message = (id: string) => ({
    id,
    threadId: "group-1",
    kind: "text" as const,
    sender: "A",
    text: id,
  });
  const existing = [message("1"), message("2"), message("3")];
  assert.deepEqual(
    mergeMessageWindows(existing, existing.slice(1), "newer").map((item) => item.text),
    ["1", "2", "3"],
  );
});

test("같은 사람이 연속해서 보낸 메시지의 unknown을 직전 이름으로 채운다", () => {
  const base = { threadId: "group-1", kind: "text" as const };
  const messages = inheritGroupedSenders([
    { ...base, id: "1", sender: "임규현", text: "지금 플렉스 ㄱㄱ" },
    { ...base, id: "2", sender: "unknown", text: "바로뽑아줌 서류" },
  ]);
  assert.equal(messages[1]?.sender, "임규현");
});

test("과거 창이 묶음 중간에서 시작하면 다음 사람 이름을 거꾸로 붙이지 않는다", () => {
  const base = { threadId: "thread-1", kind: "text" as const, timestamp: undefined };
  const messages = inheritGroupedSenders([
    { ...base, id: "1", sender: "나", text: "축구 안 할 거임?" },
    { ...base, id: "2", sender: "unknown", text: "축구화 안 들고 왔음" },
    { ...base, id: "3", sender: "unknown", text: "보드를 받아서" },
    { ...base, id: "4", sender: "x0gu.s_board", text: "보드나 탈 거임" },
  ]);

  assert.deepEqual(messages.map((message) => message.sender), [
    "나",
    "unknown",
    "unknown",
    "x0gu.s_board",
  ]);
});

test("history 병합은 같은 본문만 보고 기존 발신자를 바꾸지 않는다", () => {
  const unknown = {
    id: "old",
    threadId: "group-1",
    kind: "text" as const,
    sender: "unknown",
    text: "바로뽑아줌",
  };
  const resolved = { ...unknown, id: "new", sender: "임규현" };
  const merged = mergeMessageWindows([unknown], [resolved], "newer");
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.sender, "unknown");
});

test("동일 본문의 다른 발신자가 나타나도 추정 발신자를 덮어쓰지 않는다", () => {
  const inferred = {
    id: "old",
    threadId: "group-1",
    kind: "text" as const,
    sender: "polalmkhksohn_",
    senderInferred: true,
    text: "집갔는데 문잠겨있다 이제",
  };
  const resolved = {
    ...inferred,
    id: "new",
    sender: "hyeon_0627",
    senderInferred: undefined,
  };

  const merged = mergeMessageWindows([inferred], [resolved], "newer");
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.sender, "polalmkhksohn_");
  assert.equal(merged[0]?.senderInferred, true);
});

test("같은 본문의 앞 메시지와 뒤 답장은 각각의 발신자를 유지한다", () => {
  const base = { threadId: "group-1", text: "34343" };
  const existing = [
    {
      ...base,
      id: "original",
      kind: "text" as const,
      sender: "故추whw만함",
      senderInferred: true,
    },
    {
      ...base,
      id: "reply",
      kind: "reply" as const,
      sender: "이정민",
      replyTo: { sender: "故추whw만함" },
    },
  ];
  const incoming = [existing[1]!];

  const merged = mergeMessageWindows(existing, incoming, "older");
  assert.deepEqual(merged.map((message) => message.sender), ["故추whw만함", "이정민"]);
});

test("내 메시지 경계를 넘어 다음 발신자 이름을 이전 그룹에 붙이지 않는다", () => {
  const base = { threadId: "group-1", kind: "text" as const };
  const messages = inheritGroupedSenders([
    { ...base, id: "1", sender: "故추whw만함", text: "ㅈ박은줄 알았는데" },
    { ...base, id: "2", sender: "unknown", text: "최악정도는 아니네요" },
    { ...base, id: "3", sender: "unknown", text: "34343" },
    { ...base, id: "4", sender: "나", text: "괜찮은데?" },
    { ...base, id: "5", sender: "이정민", text: "34343" },
  ]);

  assert.deepEqual(messages.map((message) => message.sender), [
    "故추whw만함",
    "故추whw만함",
    "故추whw만함",
    "나",
    "이정민",
  ]);
});

test("내 메시지 위의 답장 인용 원문은 답장 대상의 발신자로 복원한다", () => {
  const base = { threadId: "group-1" };
  const repaired = repairReplyQuoteSenders([
    { ...base, id: "1", kind: "text", sender: "故추whw만함", text: "최악정도는 아니네요" },
    { ...base, id: "2", kind: "reply", sender: "이정민", text: "34343", replyTo: { sender: "故추whw만함" } },
    { ...base, id: "3", kind: "text", sender: "나", text: "괜찮은데?" },
    { ...base, id: "4", kind: "reply", sender: "이정민", text: "34343", replyTo: { sender: "故추whw만함" } },
    { ...base, id: "5", kind: "reply", sender: "이정민", text: "퐁당퐁당 뭔데", replyTo: { sender: "故추whw만함" } },
  ]);

  assert.deepEqual(repaired.map(({ sender, kind }) => ({ sender, kind })), [
    { sender: "故추whw만함", kind: "text" },
    { sender: "故추whw만함", kind: "text" },
    { sender: "나", kind: "text" },
    { sender: "이정민", kind: "reply" },
    { sender: "이정민", kind: "reply" },
  ]);
});

test("history에 잘못 저장된 답장 발신자도 다음 병합에서 원문 발신자로 교정한다", () => {
  const base = { threadId: "group-1" };
  const polluted = [
    { ...base, id: "1", kind: "text" as const, sender: "故추whw만함", text: "최악정도는 아니네요" },
    { ...base, id: "2", kind: "reply" as const, sender: "이정민", text: "34343", replyTo: { sender: "故추whw만함" } },
    { ...base, id: "3", kind: "text" as const, sender: "나", text: "괜찮은데?" },
    { ...base, id: "4", kind: "reply" as const, sender: "이정민", text: "34343", replyTo: { sender: "故추whw만함" } },
    { ...base, id: "5", kind: "reply" as const, sender: "이정민", text: "퐁당퐁당 뭔데", replyTo: { sender: "故추whw만함" } },
  ];
  const currentWindow = [
    { ...base, id: "fresh-1", kind: "text" as const, sender: "故추whw만함", text: "최악정도는 아니네요" },
    { ...base, id: "fresh-2", kind: "text" as const, sender: "故추whw만함", senderInferred: true, text: "34343" },
    { ...base, id: "fresh-3", kind: "text" as const, sender: "나", text: "괜찮은데?" },
  ];

  const repaired = mergeMessageWindows(polluted, currentWindow, "newer");
  assert.deepEqual(repaired.map(({ sender, text }) => ({ sender, text })), [
    { sender: "故추whw만함", text: "최악정도는 아니네요" },
    { sender: "故추whw만함", text: "34343" },
    { sender: "나", text: "괜찮은데?" },
    { sender: "이정민", text: "34343" },
    { sender: "이정민", text: "퐁당퐁당 뭔데" },
  ]);
});
