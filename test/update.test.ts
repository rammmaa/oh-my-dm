import assert from "node:assert/strict";
import test from "node:test";

import { checkForUpdate, isNewerVersion } from "../src/update.js";

test("semantic version으로 최신 버전을 비교한다", () => {
  assert.equal(isNewerVersion("0.6.3", "0.6.4"), true);
  assert.equal(isNewerVersion("0.6.3", "0.7.0"), true);
  assert.equal(isNewerVersion("0.6.3", "0.6.3"), false);
  assert.equal(isNewerVersion("0.6.3", "0.5.9"), false);
  assert.equal(isNewerVersion("invalid", "0.6.4"), false);
});

test("npm latest 응답에 새 버전이 있을 때만 업데이트를 알린다", async () => {
  const newer = await checkForUpdate("0.6.3", async () => new Response(
    JSON.stringify({ version: "0.6.4" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  const same = await checkForUpdate("0.6.3", async () => new Response(
    JSON.stringify({ version: "0.6.3" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  assert.equal(newer, "0.6.4");
  assert.equal(same, undefined);
});

test("업데이트 확인 실패는 앱 시작을 막지 않는다", async () => {
  const result = await checkForUpdate("0.6.3", async () => {
    throw new Error("offline");
  });
  assert.equal(result, undefined);
});
