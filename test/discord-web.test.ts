import assert from "node:assert/strict";
import test from "node:test";

import {
  DiscordWebConnector,
  isTransientDiscordNavigationError,
} from "../src/connectors/discord-web.js";

test("라우트 전환 중 발생하는 Playwright 오류를 일시 오류로 본다", () => {
  assert.equal(
    isTransientDiscordNavigationError(
      new Error("Execution context was destroyed, most likely because of a navigation"),
    ),
    true,
  );
  assert.equal(
    isTransientDiscordNavigationError(new Error("Target page, context or browser has been closed")),
    true,
  );
  assert.equal(isTransientDiscordNavigationError(new Error("Discord 커넥터가 시작되지 않았습니다.")), false);
});

test("시작 전 snapshot은 starting 상태이고 대화 목록이 비어 있다", () => {
  const connector = new DiscordWebConnector({ profileDir: "/tmp/oh-my-dm-discord-test-profile" });
  assert.equal(connector.getSnapshot().state, "starting");
  assert.deepEqual(connector.getSnapshot().conversations, []);
  assert.deepEqual(connector.getSnapshot().messages, []);
});
