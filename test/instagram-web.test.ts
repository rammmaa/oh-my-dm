import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright-core";

import {
  clickInstagramConversationRow,
  InstagramWebConnector,
  isTransientInstagramNavigationError,
  observeInstagramChanges,
  readInstagramMessageRows,
} from "../src/connectors/instagram-web.js";

test("tsx로 실행해도 Instagram evaluateAll 콜백이 브라우저에서 독립적으로 동작한다", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <nav role="navigation">
        <div role="button" style="width: 400px; height: 60px">
          <span>김태현님</span><span>첫 번째 대화</span>
        </div>
        <div role="button" style="width: 400px; height: 60px">
          <span>김태현님</span><span>두 번째 대화</span>
        </div>
      </nav>
    </main>
  `);
  const rows = page.locator('main [role="navigation"] [role="button"]');
  await rows.nth(0).evaluate((element) => {
    Object.defineProperty(element, "__reactFiber$test", {
      value: { memoizedProps: { threadKeyForSelection: "111" } },
      enumerable: true,
    });
  });
  await rows.nth(1).evaluate((element) => {
    Object.defineProperty(element, "__reactFiber$test", {
      value: { memoizedProps: { threadKeyForSelection: "222" } },
      enumerable: true,
    });
    element.addEventListener("click", () => element.setAttribute("data-clicked", "true"));
  });

  await rows.evaluateAll(clickInstagramConversationRow, {
    index: 0,
    title: "김태현님",
    identity: "thread:222",
  });

  assert.equal(await rows.nth(0).getAttribute("data-clicked"), null);
  assert.equal(await rows.nth(1).getAttribute("data-clicked"), "true");
});

test("tsx로 실행해도 Instagram init script가 DOM 변경을 감지한다", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(observeInstagramChanges);
  await page.goto("data:text/html,<main></main>");
  await page.evaluate(() => {
    const browserWindow = window as typeof window & {
      __ohMyDmWake?: () => void;
      __wakeCount?: number;
    };
    browserWindow.__wakeCount = 0;
    browserWindow.__ohMyDmWake = () => {
      browserWindow.__wakeCount = (browserWindow.__wakeCount ?? 0) + 1;
    };
    document.querySelector("main")?.setAttribute("aria-live", "polite");
  });

  await page.waitForFunction(() => (
    (window as typeof window & { __wakeCount?: number }).__wakeCount ?? 0
  ) > 0);
});

test("Instagram 인라인 공유는 작성자 ID를 제목으로 쓰지 않고 릴스로 표시한다", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <iframe src="data:text/html,cross-origin-frame"></iframe>
      <section>
        <div>故추whw만함</div>
        <div role="row">
          <img alt="zxngw0o님의 프로필 사진" />
          <div class="media-card"><a href="/boseok_i/">boseok_i</a></div>
        </div>
      </section>
      <section>
        <div>박가은</div>
        <div role="row"><a href="/reel/ABC123/" aria-label="축구 끝나고 집 가는 길">author_id</a></div>
      </section>
      <section>
        <div>임규현</div>
        <div role="row" class="normal-message"><span>일반 메시지</span></div>
      </section>
    </main>
  `);
  await page.locator(".media-card").evaluate((element) => {
    Object.defineProperty(element, "__reactFiber$test", {
      enumerable: true,
      value: {
        memoizedProps: {
          embeddedWindow: document.querySelector("iframe")?.contentWindow,
          slideMessageRef: { content_type: "MESSAGE_INLINE_SHARE" },
        },
        child: {
          sibling: {
            child: {
              memoizedProps: {
                headerTitle: "boseok_i",
                targetUrl: "https://www.instagram.com/p/DcyUcaniV-t/?carousel_share_child_media_id=3977331270096415912_5756598919&is_ineligible_for_clips_chaining=false",
              },
            },
          },
        },
      },
    });
  });
  await page.locator(".normal-message").evaluate((element) => {
    Object.defineProperty(element, "__reactFiber$test", {
      enumerable: true,
      value: {
        memoizedProps: { text: "일반 메시지" },
        // A root sibling represents an adjacent DOM message and must not
        // affect classification of this row.
        sibling: {
          memoizedProps: {
            content_type: "MESSAGE_INLINE_SHARE",
            targetUrl: "https://www.instagram.com/reel/NEIGHBOR/",
          },
        },
      },
    });
  });

  const messages = await page
    .locator('main [role="row"]')
    .evaluateAll(readInstagramMessageRows);

  assert.equal(messages[0]?.sender, "故추whw만함");
  assert.equal(messages[0]?.text.trim(), "(릴스)");
  assert.equal(messages[0]?.kind, "reel");
  assert.equal(messages[1]?.sender, "박가은");
  assert.equal(messages[1]?.text.trim(), "축구 끝나고 집 가는 길(릴스)");
  assert.equal(messages[2]?.sender, "임규현");
  assert.equal(messages[2]?.text.trim(), "일반 메시지");
});

test("이전 메시지 DOM이 깨어나기 전에 older 병합 방향을 설정한다", async () => {
  const connector = new InstagramWebConnector({ profileDir: "/tmp/unused-profile" });
  const internalState = connector as unknown as { loadingOlder: boolean };
  let loadingOlderWhileScrolling = false;
  Object.assign(connector, {
    page: {
      url: () => "https://www.instagram.com/direct/t/thread-1/",
      waitForTimeout: async () => undefined,
      locator: () => ({
        evaluate: async () => {
          loadingOlderWhileScrolling = internalState.loadingOlder;
          return false;
        },
      }),
    },
  });

  assert.equal(await connector.loadOlderMessages(), 0);
  assert.equal(loadingOlderWhileScrolling, true);
  assert.equal(internalState.loadingOlder, false);
});

test("Instagram 화면 전환 중 사라진 execution context는 재시도 가능한 오류다", () => {
  assert.equal(
    isTransientInstagramNavigationError(
      new Error(
        "locator.evaluateAll: Execution context was destroyed, most likely because of a navigation",
      ),
    ),
    true,
  );
  assert.equal(isTransientInstagramNavigationError(new Error("Frame was detached")), true);
});

test("실제 DOM 오류는 화면 전환 오류로 숨기지 않는다", () => {
  assert.equal(
    isTransientInstagramNavigationError(new Error("locator.evaluateAll: selector is invalid")),
    false,
  );
});
