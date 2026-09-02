import assert from "node:assert/strict";
import test from "node:test";

import { getMessageWindow } from "../src/ui/message-window.js";

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
