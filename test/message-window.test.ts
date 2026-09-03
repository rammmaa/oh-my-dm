import assert from "node:assert/strict";
import test from "node:test";

import { getMessageWindow, getOlderMessageOffset } from "../src/ui/message-window.js";

test("최신 메시지부터 보이는 개수만큼 표시한다", () => {
  assert.deepEqual(getMessageWindow([0, 1, 2, 3, 4], 3, 0), {
    items: [2, 3, 4],
    start: 2,
    end: 5,
    maxOffset: 2,
  });
});

test("아래 기준 offset으로 과거 메시지를 탐색한다", () => {
  assert.deepEqual(getMessageWindow([0, 1, 2, 3, 4], 3, 2), {
    items: [0, 1, 2],
    start: 0,
    end: 3,
    maxOffset: 2,
  });
});

test("장문 메시지가 차지하는 줄 수만큼 표시 개수를 줄인다", () => {
  const messages = [1, 3, 1, 1];
  assert.deepEqual(getMessageWindow(messages, 3, 0, (rows) => rows), {
    items: [1, 1],
    start: 2,
    end: 4,
    maxOffset: 3,
  });
});

test("PageUp은 전체 기록의 맨 위가 아니라 한 화면만 이동한다", () => {
  assert.equal(getOlderMessageOffset(2, 40, 6, true), 8);
  assert.equal(getOlderMessageOffset(38, 40, 6, true), 40);
});

test("위 방향키는 메시지 한 항목만 이동한다", () => {
  assert.equal(getOlderMessageOffset(2, 40, 6, false), 3);
});

test("이전 메시지가 앞에 붙으면 보던 위치에서 한 항목만 위로 이어진다", () => {
  const before = getMessageWindow(["a", "b", "c", "d", "e", "f"], 5, 1);
  assert.deepEqual(before.items, ["a", "b", "c", "d", "e"]);

  const after = getMessageWindow(
    ["old-1", "old-2", "old-3", "old-4", "a", "b", "c", "d", "e", "f"],
    5,
    2,
  );
  assert.deepEqual(after.items, ["old-4", "a", "b", "c", "d"]);
});
