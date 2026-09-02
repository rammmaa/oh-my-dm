import assert from "node:assert/strict";
import test from "node:test";

import {
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
