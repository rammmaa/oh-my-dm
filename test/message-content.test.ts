import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage } from "../src/domain.js";
import {
  formatMessageText,
  formatMessagePreview,
  inferMessageKind,
  normalizeMessageContent,
  parseReplyReference,
} from "../src/message-content.js";

test("connector 문구를 공통 메시지 타입으로 분류한다", () => {
  assert.equal(inferMessageKind("사진을 보냈습니다."), "image");
  assert.equal(inferMessageKind("sent a video"), "video");
  assert.equal(inferMessageKind("이모티콘을 보냈습니다."), "sticker");
  assert.equal(inferMessageKind("회원님의 메시지에 😢로 공감했습니다"), "reaction");
  assert.equal(inferMessageKind("메시지가 삭제되었습니다."), "deleted");
  assert.equal(inferMessageKind("축구 끝나고 집 가는 길(릴스)"), "reel");
  assert.equal(inferMessageKind("평범한 메시지"), "text");
});

test("수정 여부를 본문과 분리한다", () => {
  assert.deepEqual(normalizeMessageContent("안녕하세요 (수정됨)"), {
    kind: "text",
    text: "안녕하세요",
    edited: true,
  });
  assert.deepEqual(normalizeMessageContent("수정됨: 다시 쓴 메시지"), {
    kind: "text",
    text: "다시 쓴 메시지",
    edited: true,
  });
});

test("답장 라벨에서 참조 대상을 분리한다", () => {
  assert.deepEqual(parseReplyReference("이정민 replied to 故추whw만함"), {
    sender: "故추whw만함",
  });
  assert.deepEqual(parseReplyReference("이정민님이 회원님에게 답장했습니다"), {
    sender: "나",
  });
});

test("메시지 타입을 언어별로 일관되게 표시한다", () => {
  const message = (kind: ChatMessage["kind"], text: string, edited = false): ChatMessage => ({
    id: "1",
    threadId: "thread-1",
    kind,
    sender: "Alice",
    text,
    ...(edited ? { edited: true } : {}),
  });

  assert.equal(formatMessageText(message("image", "사진을 보냈습니다."), "ko"), "(사진)");
  assert.equal(formatMessageText(message("image", "sent a photo"), "en"), "(Image)");
  assert.equal(
    formatMessageText(message("reel", "축구 끝나고 집 가는 길(릴스)"), "ko"),
    "축구 끝나고 집 가는 길(릴스)",
  );
  assert.equal(formatMessageText(message("text", "hello", true), "en"), "hello (edited)");
  assert.equal(
    formatMessageText({
      ...message("reply", "집갔는데 문잠겨있다 이제"),
      replyTo: { sender: "임규현", text: "문이 잠겼다는 메시지" },
    }, "ko"),
    "↪ 임규현 “문이 잠겼다는 메시지”에 답장 · 집갔는데 문잠겨있다 이제",
  );
  assert.equal(
    formatMessageText({
      ...message("reply", "I got home"),
      replyTo: { sender: "Alex" },
    }, "en"),
    "↪ Reply to Alex · I got home",
  );
  assert.equal(
    formatMessagePreview("사진을 보냈습니다. · 오후 3:54", "ko"),
    "(사진) · 오후 3:54",
  );
});
