import assert from "node:assert/strict";
import test from "node:test";
import stringWidth from "string-width";

import { padToWidth, truncateToWidth } from "../src/ui/text-layout.js";

test("한글을 터미널 두 칸 너비로 계산해 패딩한다", () => {
  assert.equal(stringWidth(padToWidth("김태현", 10)), 10);
});

test("긴 미리보기를 표시 폭 안에서 말줄임한다", () => {
  const value = truncateToWidth("회원님의 메시지에 😢로 공감했습니다", 18);
  assert.ok(stringWidth(value) <= 18);
  assert.match(value, /…$/);
});
