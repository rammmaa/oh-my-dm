import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeKakaoField,
  reconcilePendingOwnMessages,
} from "../src/connectors/kakao-native.js";

test("방금 보낸 카카오톡 메시지는 접근성 발신자 오판보다 우선해 내 메시지로 보정한다", () => {
  const result = reconcilePendingOwnMessages(
    [
      { text: "좀 낭만잇다 가사", sender: "황준혁" },
      { text: "윙줌이되자", sender: "황준혁" },
    ],
    ["윙줌이되자"],
  );

  assert.equal(result.messages[0]?.sender, "황준혁");
  assert.equal(result.messages[1]?.sender, "나");
  assert.deepEqual(result.remaining, []);
});

test("아직 화면에 나타나지 않은 내 메시지는 다음 조회까지 유지한다", () => {
  const result = reconcilePendingOwnMessages(
    [{ text: "기존 메시지", sender: "김태현" }],
    ["아직 전송 중"],
  );

  assert.deepEqual(result.remaining, ["아직 전송 중"]);
});

test("카카오 대화 필드의 탭과 줄바꿈을 일반 공백으로 정규화한다", () => {
  assert.equal(normalizeKakaoField("\tㅋㅋㅋㅋㅋㅋ\r\n · 어제  "), "ㅋㅋㅋㅋㅋㅋ · 어제");
  assert.equal(normalizeKakaoField("  황준혁\u00a0"), "황준혁");
});
