import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright-core";

import type { ChatMessage } from "../src/domain.js";
import {
  compareSnowflakes,
  isTextChannelLabel,
  mergeDiscordConversations,
  mergeDiscordMessages,
  normalizeDiscordChannelRow,
  normalizeDiscordDmRow,
  normalizeDiscordMessages,
  parseDiscordRoute,
  readDiscordChannelRows,
  readDiscordCurrentUser,
  readDiscordDmRows,
  readDiscordGuildRows,
  readDiscordMessageRows,
  readDiscordSidebarGuildName,
  titleFromDiscordLabel,
} from "../src/connectors/discord-dom.js";

test("Discord URL에서 guild id와 channel id를 읽는다", () => {
  assert.deepEqual(parseDiscordRoute("https://discord.com/channels/@me"), { login: false });
  assert.deepEqual(parseDiscordRoute("https://discord.com/channels/@me/111"), { login: false, channelId: "111" });
  assert.deepEqual(parseDiscordRoute("https://discord.com/channels/22/333?x=1"), { login: false, guildId: "22", channelId: "333" });
  assert.deepEqual(parseDiscordRoute("https://discord.com/channels/22"), { login: false, guildId: "22" });
  assert.deepEqual(parseDiscordRoute("https://discord.com/login?redirect_to=%2Fchannels%2F%40me"), { login: true });
  assert.deepEqual(parseDiscordRoute("https://discord.com/app"), { login: false });
});

test("aria-label에서 마지막 괄호 설명을 떼어 제목을 만든다", () => {
  assert.equal(titleFromDiscordLabel("이협 (다이렉트 메시지), 온라인", "x"), "이협");
  assert.equal(titleFromDiscordLabel("juwonhyme (다이렉트 메시지)", "x"), "juwonhyme");
  assert.equal(titleFromDiscordLabel("스터디 (bar) (그룹 메시지), 3명", "x"), "스터디 (bar)");
  assert.equal(titleFromDiscordLabel(null, " fallback "), "fallback");
});

test("음성, 스테이지, 포럼, 미디어 채널은 텍스트 채널로 보지 않는다", () => {
  assert.equal(isTextChannelLabel("잡담 (채팅 채널)"), true);
  assert.equal(isTextChannelLabel("general (text channel)"), true);
  assert.equal(isTextChannelLabel("media (채팅 채널)"), true);
  assert.equal(isTextChannelLabel("라운지 (음성 채널)"), false);
  assert.equal(isTextChannelLabel("아파트 (forum channel)"), false);
  assert.equal(isTextChannelLabel("stage (stage channel)"), false);
  assert.equal(isTextChannelLabel(null), true);
});

test("DM 행과 채널 행을 Conversation으로 정규화한다", () => {
  assert.deepEqual(
    normalizeDiscordDmRow({ href: "/channels/@me/111", label: "이협 (다이렉트 메시지), 온라인", name: "이협", unread: true }),
    { id: "111", title: "이협", href: "/channels/@me/111", unread: true },
  );
  assert.equal(normalizeDiscordDmRow({ href: "/channels/@me/shop", label: null, name: "Shop", unread: false }), undefined);
  assert.deepEqual(
    normalizeDiscordChannelRow({ href: "/channels/22/333", label: "잡담 (채팅 채널)", name: "잡담", unread: false }, "술코"),
    { id: "333", identity: "guild:22", title: "술코 #잡담", href: "/channels/22/333", unread: false },
  );
  assert.equal(
    normalizeDiscordChannelRow({ href: "/channels/22/444", label: "라운지 (음성 채널)", name: "라운지", unread: false }, "술코"),
    undefined,
  );
});

test("헤더 없는 이어지는 메시지는 이전 발신자를 물려받고 내 메시지는 나로 표시한다", () => {
  const messages = normalizeDiscordMessages([
    { id: "1", channelId: "9", sender: "Zyø", own: false, timestamp: "2026-08-16T11:59:18", text: "안녕", kind: "text", edited: false },
    { id: "2", channelId: "9", sender: null, own: false, timestamp: null, text: "", kind: "image", edited: false },
    { id: "3", channelId: "9", sender: "하람", own: true, timestamp: null, text: "넹", kind: "text", edited: true, replyTo: { sender: "Zyø", text: "안녕" } },
    { id: "4", channelId: "9", sender: null, own: true, timestamp: null, text: "!!", kind: "text", edited: false },
    { id: "5", channelId: "9", sender: null, own: false, timestamp: null, text: "", kind: "text", edited: false },
  ]);
  assert.deepEqual(
    messages.map((message) => [message.id, message.sender, message.kind, message.senderInferred ?? false]),
    [
      ["1", "Zyø", "text", false],
      ["2", "Zyø", "image", true],
      ["3", "나", "reply", false],
      ["4", "나", "text", false],
    ],
  );
  assert.equal(messages[2]?.edited, true);
  assert.deepEqual(messages[2]?.replyTo, { sender: "Zyø", text: "안녕" });
  assert.equal(messages[0]?.threadId, "9");
});

test("snowflake id 순서로 메시지를 합치고 화면 범위 안에서 사라진 메시지는 버린다", () => {
  const make = (id: string, text = id): ChatMessage => ({ id, threadId: "9", kind: "text", sender: "a", text });
  assert.equal(compareSnowflakes("99", "100"), -1);
  assert.equal(compareSnowflakes("100", "100"), 0);
  const merged = mergeDiscordMessages(
    [make("10"), make("20"), make("30"), make("40")],
    [make("20"), make("40", "edited"), make("50")],
  );
  assert.deepEqual(merged.map((message) => message.id), ["10", "20", "40", "50"]);
  assert.equal(merged[2]?.text, "edited");
  assert.deepEqual(mergeDiscordMessages([make("10")], []).map((message) => message.id), ["10"]);
});

test("대화 목록은 앞 목록 순서를 지키고 뒤 목록의 새 항목을 덧붙인다", () => {
  const merged = mergeDiscordConversations(
    [
      { id: "2", title: "b", href: "/channels/@me/2", unread: true },
      { id: "1", title: "a", href: "/channels/@me/1", unread: false },
    ],
    [
      { id: "1", title: "a", href: "/channels/@me/1", unread: true },
      { id: "3", title: "c", href: "/channels/@me/3", unread: false },
    ],
  );
  assert.deepEqual(merged.map((item) => [item.id, item.unread]), [["2", true], ["1", false], ["3", false]]);
});

test("브라우저에서 DM 행, 서버 행, 채널 행, 사용자 정보를 읽는다", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  await page.setContent(`
    <nav data-list-id="guildsnav">
      <div data-list-item-id="guildsnav___home" role="treeitem"></div>
      <div data-list-item-id="guildsnav___create-join-button" role="treeitem"></div>
      <div class="listItem_a">
        <div data-dnd-name="술코"><div data-list-item-id="guildsnav___1538517028644855818" role="treeitem"></div></div>
        <div class="pill_a"><span class="unread_b"></span></div>
      </div>
      <div class="listItem_a">
        <div data-dnd-name="C++ Korea, PyLadies"><div data-list-item-id="guildsnav___2880559708" role="treeitem" class="folderButton__48112" aria-expanded="false"></div></div>
      </div>
    </nav>
    <nav data-list-id="private-channels-uid_11">
      <a href="/channels/@me/111" aria-label="이협 (다이렉트 메시지), 온라인" data-list-item-id="private-channels-uid_11___111"><div class="name__20a53">이협 </div></a>
      <a href="/channels/@me/222" aria-label="juwonhyme (다이렉트 메시지)" data-list-item-id="private-channels-uid_11___222"><div class="name__20a53">juwonhyme</div><div class="badge__10651">3</div></a>
      <a href="/channels/@me/shop" data-list-item-id="private-channels-uid_11___shop"><div class="name__20a53">Shop</div><div class="newBadge__4ed1a">신규</div></a>
    </nav>
    <nav aria-label="술코 (서버)">
      <ul aria-label="채널">
        <li><a role="link" href="/channels/22/333" aria-label="잡담 (채팅 채널)" data-list-item-id="channels___333"><div class="name__x">잡담</div></a></li>
        <li><a role="link" href="/channels/22/444" aria-label="공지 (채팅 채널)" data-list-item-id="channels___444"><div class="name__x modeUnread__y">공지</div></a></li>
        <li><a role="link" href="/channels/22/555" aria-label="라운지 (음성 채널)" data-list-item-id="channels___555"><div class="name__x">라운지</div></a></li>
      </ul>
    </nav>
    <section aria-label="사용자 상태 및 설정"><div class="nameTag__37e49"><div class="panelTitleContainer__37e49">하람</div><div>rammma__</div></div></section>
    <script>
      document.querySelector('.nameTag__37e49')['__reactFiber$test'] = {
        memoizedProps: {},
        return: { memoizedProps: { user: { id: '5638', globalName: '하람', username: 'rammma__' } } },
      };
    </script>
  `);

  const dmRows = await page
    .locator('[data-list-id^="private-channels"] a[href^="/channels/@me/"]')
    .evaluateAll(readDiscordDmRows);
  assert.deepEqual(dmRows, [
    { href: "/channels/@me/111", label: "이협 (다이렉트 메시지), 온라인", name: "이협", unread: false },
    { href: "/channels/@me/222", label: "juwonhyme (다이렉트 메시지)", name: "juwonhyme", unread: true },
  ]);

  const guildRows = await page.locator('[data-list-item-id^="guildsnav___"]').evaluateAll(readDiscordGuildRows);
  assert.deepEqual(guildRows, [
    { id: "1538517028644855818", name: "술코", folder: false, unread: true },
    { id: "2880559708", name: "C++ Korea, PyLadies", folder: true, expanded: false, unread: false },
  ]);

  const channelRows = await page.locator('a[data-list-item-id^="channels___"]').evaluateAll(readDiscordChannelRows);
  assert.deepEqual(channelRows, [
    { href: "/channels/22/333", label: "잡담 (채팅 채널)", name: "잡담", unread: false },
    { href: "/channels/22/444", label: "공지 (채팅 채널)", name: "공지", unread: true },
    { href: "/channels/22/555", label: "라운지 (음성 채널)", name: "라운지", unread: false },
  ]);

  const user = await page.locator('[class*="nameTag"]').first().evaluate(readDiscordCurrentUser);
  assert.deepEqual(user, { id: "5638", displayName: "하람" });

  const guildName = await page
    .locator('a[data-list-item-id^="channels___"]')
    .first()
    .evaluate(readDiscordSidebarGuildName);
  assert.equal(guildName, "술코");
});

test("브라우저에서 메시지 행을 읽는다", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  await page.setContent(`
    <ol data-list-id="chat-messages">
      <div class="wrapper_x"><h1>#잡담에 오신 것을 환영합니다</h1></div>
      <div class="divider_x" role="separator">2026년 8월 30일</div>
      <li id="chat-messages-9-10"><div class="message_x groupStart_x">
        <h3><span id="message-username-10" class="headerText_x"><span class="username_x">Zyø</span><span><span class="copyOnlyText_x"> [PS], </span><span class="clanTagChiplet_x">서버 태그: PSPS</span></span></span><time datetime="2026-08-16T11:59:18.000Z">오후 8:59</time></h3>
        <div id="message-content-10">안녕 <img class="emoji" alt="😀"> 여러분<br>둘째 줄<span class="edited_x">(수정됨)</span></div>
      </div></li>
      <li id="chat-messages-9-11"><div class="message_x">
        <time datetime="2026-08-16T11:59:32.000Z">오후 8:59</time>
        <div id="message-content-11"></div>
        <div class="messageAttachment_x"><div class="imageWrapper_x"><img alt="image.png"></div></div>
      </div></li>
      <li id="chat-messages-9-12"><div class="message_x groupStart_x">
        <div id="message-reply-context-12"><span class="username_y">@하람</span><div id="message-content-12-reply">넹!!!!</div></div>
        <h3><span id="message-username-12"><span class="username_x">Zyø</span></span><time datetime="2026-08-16T12:00:00.000Z">오후 9:00</time></h3>
        <div id="message-content-12">기대하겠어요</div>
      </div></li>
      <li id="chat-messages-9-13"><div class="message_x systemMessage_x">
        <time datetime="2026-08-16T12:01:00.000Z">오후 9:01</time><span>하람님이 서버에 참여했습니다.</span>
      </div></li>
      <li id="chat-messages-9-14"><div class="message_x groupStart_x">
        <h3><span id="message-username-14"><span class="username_x">하람</span></span><time datetime="2026-08-16T12:02:00.000Z">오후 9:02</time></h3>
        <div id="message-content-14">내 메시지</div>
      </div></li>
    </ol>
    <script>
      const fiberFor = (authorId, type) => ({ memoizedProps: {}, return: { memoizedProps: { message: { author: { id: authorId }, type } } } });
      document.getElementById('chat-messages-9-10')['__reactFiber$test'] = fiberFor('9633', 0);
      document.getElementById('chat-messages-9-11')['__reactFiber$test'] = fiberFor('9633', 0);
      document.getElementById('chat-messages-9-12')['__reactFiber$test'] = fiberFor('9633', 19);
      document.getElementById('chat-messages-9-13')['__reactFiber$test'] = fiberFor('5638', 7);
      document.getElementById('chat-messages-9-14')['__reactFiber$test'] = fiberFor('5638', 0);
    </script>
  `);

  const rows = await page
    .locator('ol[data-list-id="chat-messages"] li[id^="chat-messages-"]')
    .evaluateAll(readDiscordMessageRows, "5638");
  assert.deepEqual(rows, [
    { id: "10", channelId: "9", sender: "Zyø", own: false, timestamp: "2026-08-16T11:59:18.000Z", text: "안녕 😀 여러분\n둘째 줄", kind: "text", edited: true },
    { id: "11", channelId: "9", sender: null, own: false, timestamp: "2026-08-16T11:59:32.000Z", text: "", kind: "image", edited: false },
    { id: "12", channelId: "9", sender: "Zyø", own: false, timestamp: "2026-08-16T12:00:00.000Z", text: "기대하겠어요", kind: "text", edited: false, replyTo: { sender: "하람", text: "넹!!!!" } },
    { id: "13", channelId: "9", sender: null, own: true, timestamp: "2026-08-16T12:01:00.000Z", text: "하람님이 서버에 참여했습니다.", kind: "system", edited: false },
    { id: "14", channelId: "9", sender: "하람", own: true, timestamp: "2026-08-16T12:02:00.000Z", text: "내 메시지", kind: "text", edited: false },
  ]);
});
