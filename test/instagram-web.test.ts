import assert from "node:assert/strict";
import test from "node:test";

import { isTransientInstagramNavigationError } from "../src/connectors/instagram-web.js";

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
