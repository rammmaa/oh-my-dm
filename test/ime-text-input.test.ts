import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInputChunk,
  nextGraphemeOffset,
  previousGraphemeOffset,
} from "../src/ui/ime-text-input.js";

test("한글과 emoji를 UTF-16 코드 단위가 아닌 grapheme 단위로 이동한다", () => {
  const value = "한글👨‍👩‍👧‍👦끝";
  const emojiStart = "한글".length;
  const emojiEnd = "한글👨‍👩‍👧‍👦".length;

  assert.equal(nextGraphemeOffset(value, emojiStart), emojiEnd);
  assert.equal(previousGraphemeOffset(value, emojiEnd), emojiStart);
  assert.equal(previousGraphemeOffset(value, value.length), emojiEnd);
});

test("한글 IME가 확정 문자와 Enter를 함께 보내도 완성된 값을 즉시 제출한다", () => {
  assert.deepEqual(applyInputChunk("/open ", "/open ".length, "서정현\r"), {
    value: "/open 서정현",
    cursorOffset: "/open 서정현".length,
    submit: true,
  });

  assert.deepEqual(applyInputChunk("", 0, "/open 서정현\r"), {
    value: "/open 서정현",
    cursorOffset: "/open 서정현".length,
    submit: true,
  });
});
