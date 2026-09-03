import type { ChatMessage, MessageKind, MessageReference } from "./domain.js";

export interface NormalizedMessageContent {
  kind: MessageKind;
  text: string;
  edited?: boolean;
}

const GENERIC_MEDIA_PATTERNS: ReadonlyArray<{
  kind: MessageKind;
  patterns: readonly RegExp[];
}> = [
  {
    kind: "image",
    patterns: [
      /^(?:사진|이미지)(?:을|를)? 보냈습니다\.?$/i,
      /^(?:sent (?:a |an )?(?:photo|image)|photo|image)$/i,
    ],
  },
  {
    kind: "video",
    patterns: [
      /^(?:동영상|비디오)(?:을|를)? 보냈습니다\.?$/i,
      /^(?:sent (?:a )?video|video)$/i,
    ],
  },
  {
    kind: "sticker",
    patterns: [
      /^(?:이모티콘|스티커)(?:을|를)? 보냈습니다\.?$/i,
      /^(?:sent (?:a )?(?:sticker|emoji)|sticker)$/i,
    ],
  },
  {
    kind: "deleted",
    patterns: [
      /^(?:메시지가 삭제되었습니다|삭제된 메시지)\.?$/i,
      /^(?:this message was deleted|message deleted)\.?$/i,
    ],
  },
  {
    kind: "reaction",
    patterns: [
      /^(?:회원님의|내) 메시지에 .+?(?:로|으로) 공감했습니다\.?$/i,
      /^reacted .+? to (?:your|a) message\.?$/i,
    ],
  },
  {
    kind: "system",
    patterns: [
      /^여기까지 읽었습니다\.?$/i,
      /^read up to here\.?$/i,
    ],
  },
];

export function normalizeMessageContent(
  value: string,
  explicitKind?: MessageKind,
): NormalizedMessageContent | undefined {
  let text = value.trim();
  if (!text) return undefined;

  let edited = false;
  if (/^수정됨:\s*/i.test(text)) {
    text = text.replace(/^수정됨:\s*/i, "").trim();
    edited = true;
  }
  if (/\s*\((?:수정됨|edited)\)\s*$/i.test(text)) {
    text = text.replace(/\s*\((?:수정됨|edited)\)\s*$/i, "").trim();
    edited = true;
  }
  if (!text) return undefined;

  const kind = explicitKind ?? inferMessageKind(text);
  return {
    kind,
    text,
    ...(edited ? { edited: true } : {}),
  };
}

export function inferMessageKind(text: string): MessageKind {
  if (/\(릴스\)\s*$/i.test(text) || /^\(?reel\)?$/i.test(text)) return "reel";
  if (/\(게시물\)\s*$/i.test(text) || /^\(?post\)?$/i.test(text)) return "post";
  for (const candidate of GENERIC_MEDIA_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(text))) return candidate.kind;
  }
  return "text";
}

export function parseReplyReference(value?: string | null): MessageReference | undefined {
  const label = value?.replaceAll("\u00a0", " ").trim();
  if (!label) return undefined;

  const english = label.match(/^.+? replied to (.+)$/i)?.[1]?.trim();
  if (english) return { sender: /^(?:you|yourself)$/i.test(english) ? "나" : english };

  const korean =
    label.match(/^.+?님이 (.+?)님에게 보낸 답장$/)?.[1]?.trim() ??
    (label.match(/^.+?님이 회원님에게 답장했습니다$/) ? "나" : undefined);
  return korean ? { sender: korean } : undefined;
}

export function formatMessageText(
  message: Pick<ChatMessage, "kind" | "text" | "edited" | "replyTo">,
  language: "ko" | "en",
): string {
  const labels = language === "ko"
    ? {
        image: "(사진)",
        video: "(동영상)",
        reel: "(릴스)",
        post: "(게시물)",
        sticker: "(이모티콘)",
        deleted: "(삭제된 메시지)",
        system: "(시스템 메시지)",
        edited: "(수정됨)",
      }
    : {
        image: "(Image)",
        video: "(Video)",
        reel: "(Reel)",
        post: "(Post)",
        sticker: "(Sticker)",
        deleted: "(Deleted message)",
        system: "(System message)",
        edited: "(edited)",
      };

  let text = message.text;
  if (["image", "video", "sticker", "deleted", "system"].includes(message.kind)) {
    text = labels[message.kind as "image" | "video" | "sticker" | "deleted" | "system"];
  } else if (message.kind === "reel") {
    text = replaceTypedSuffix(text, /\(릴스\)\s*$/i, labels.reel);
  } else if (message.kind === "post") {
    text = replaceTypedSuffix(text, /\(게시물\)\s*$/i, labels.post);
  }

  if (message.kind === "reply" && message.replyTo?.sender) {
    const target = message.replyTo.sender;
    const quote = message.replyTo.text
      ? ` “${truncateInline(message.replyTo.text, 48)}”`
      : "";
    text = language === "ko"
      ? quote
        ? `↪ ${target}${quote}에 답장 · ${text}`
        : `↪ ${target}에게 답장 · ${text}`
      : `↪ Reply to ${target}${quote} · ${text}`;
  }

  return message.edited && !text.endsWith(labels.edited) ? `${text} ${labels.edited}` : text;
}

export function formatMessagePreview(value: string, language: "ko" | "en"): string {
  return value
    .split(" · ")
    .map((part) => {
      const content = normalizeMessageContent(part);
      return content
        ? formatMessageText(
            { kind: content.kind, text: content.text, edited: content.edited },
            language,
          )
        : part;
    })
    .join(" · ");
}

function replaceTypedSuffix(text: string, suffix: RegExp, fallback: string): string {
  if (suffix.test(text)) {
    const title = text.replace(suffix, "").trim();
    return title ? `${title}${fallback}` : fallback;
  }
  return /^\(?(?:reel|post)\)?$/i.test(text.trim()) ? fallback : `${text}${fallback}`;
}

function truncateInline(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length <= limit
    ? normalized
    : `${characters.slice(0, Math.max(1, limit - 1)).join("")}…`;
}
