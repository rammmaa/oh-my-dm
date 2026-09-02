import assert from "node:assert/strict";
import test from "node:test";

import { CONNECTOR_COLORS, findTheme, getTheme, UI_THEMES } from "../src/ui/theme.js";

test("Claude와 GJC 기반 테마를 제공한다", () => {
  assert.deepEqual(UI_THEMES.map((theme) => theme.id), ["claude", "ouroboros", "blue-crab"]);
});

test("테마 id와 표시 이름으로 테마를 찾는다", () => {
  assert.equal(findTheme("ouroboros")?.label, "Ouroboros");
  assert.equal(findTheme("Blue Crab")?.id, "blue-crab");
  assert.equal(getTheme("missing").id, "claude");
});

test("connector 표식에 Instagram과 KakaoTalk 브랜드 색을 제공한다", () => {
  assert.equal(CONNECTOR_COLORS.instagram, "#E1306C");
  assert.equal(CONNECTOR_COLORS.kakaotalk, "#FEE500");
});
