import assert from "node:assert/strict";
import test from "node:test";
import stringWidth from "string-width";

import { formatUserMessageLines } from "../src/ui/user-message.js";

test("내 메시지를 터미널 전체 폭의 배경 행으로 만든다", () => {
  const lines = formatUserMessageLines("한글 장문 메시지를 여러 줄로 표시합니다", 18);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => stringWidth(line) === 18));
  assert.match(lines[0]!, /^ › /);
});
