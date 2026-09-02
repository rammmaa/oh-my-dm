import type { ChatMessage, Conversation } from "../domain.js";

export interface RawConversation {
  href: string;
  text: string;
  ariaLabel?: string | null;
}

export interface RawMessage {
  text: string;
  sender?: string | null;
  ariaLabel?: string | null;
  timestamp?: string | null;
}

export function threadIdFromHref(href: string): string | undefined {
  if (/^button:\d+$/.test(href)) return href;
  return href.match(/\/direct\/t\/([^/?#]+)/)?.[1];
}

export function normalizeConversation(raw: RawConversation): Conversation | undefined {
  const id = threadIdFromHref(raw.href);
  if (!id) return undefined;

  const lines = uniqueLines(raw.text);
  const title = lines[0] ?? `thread-${id.slice(0, 8)}`;
  const unreadText = `${raw.ariaLabel ?? ""} ${raw.text}`.toLowerCase();

  return {
    id,
    href: raw.href,
    title,
    preview: lines.slice(1).join(" · ") || undefined,
    unread: /unread|읽지 않|새 메시지/.test(unreadText),
  };
}

export function stabilizeButtonConversationIds(items: Conversation[]): Conversation[] {
  const titleOccurrences = new Map<string, number>();
  return items.map((item) => {
    if (!item.href.startsWith("button:")) return item;
    const occurrence = titleOccurrences.get(item.title) ?? 0;
    titleOccurrences.set(item.title, occurrence + 1);
    return {
      ...item,
      id: `button-thread:${stableHash(`${item.title}\0${occurrence}`)}`,
    };
  });
}

export function restoreTransientConversationGaps(
  previous: Conversation[],
  current: Conversation[],
): Conversation[] {
  if (previous.length === 0 || current.length === 0) return current;

  const currentIds = new Set(current.map((item) => item.id));
  const restored = [...current];
  for (let index = 0; index < previous.length; index += 1) {
    const missing = previous[index]!;
    if (currentIds.has(missing.id)) continue;

    const before = previous.slice(0, index).reverse().find((item) => currentIds.has(item.id));
    const after = previous.slice(index + 1).find((item) => currentIds.has(item.id));
    if (!before || !after) continue;

    const beforeIndex = restored.findIndex((item) => item.id === before.id);
    const afterIndex = restored.findIndex((item) => item.id === after.id);
    if (beforeIndex < 0 || afterIndex <= beforeIndex) continue;
    restored.splice(afterIndex, 0, missing);
    currentIds.add(missing.id);
  }
  return restored;
}

export function normalizeMessage(
  threadId: string,
  raw: RawMessage,
  index: number,
): ChatMessage | undefined {
  const text = uniqueLines(raw.text).join("\n").trim();
  if (!text) return undefined;

  const aria = raw.ariaLabel?.trim() ?? "";
  const sender =
    normalizeSenderLabel(raw.sender) ||
    normalizeSenderLabel(aria.match(/^([^,:]+)[,:]/)?.[1]) ||
    "unknown";
  const timestamp = raw.timestamp?.trim() || undefined;
  const id = stableHash(`${threadId}\0${sender}\0${timestamp ?? ""}\0${text}\0${index}`);

  return { id, threadId, sender, text, timestamp };
}

export function normalizeSenderLabel(value?: string | null): string | undefined {
  const label = value?.replaceAll("\u00a0", " ").trim();
  if (!label) return undefined;

  const patterns = [
    /^(.+?)님의? 프로필 사진$/,
    /^(.+?)님이 보낸 메시지(?:입니다)?$/,
    /^(.+?)님의? 프로필 페이지(?:를)? 열기$/,
    /^(.+?)의 프로필 페이지(?:를)? 열기$/,
    /^open the profile page of (.+)$/i,
    /^(.+?) replied to you$/i,
    /^(.+?)님이 회원님에게 답장했습니다$/,
    /^(.+?)(?:'s|’s) profile picture$/i,
    /^profile picture of (.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = label.match(pattern)?.[1]?.trim();
    if (match) return match;
  }

  if (/^(?:프로필 사진|profile picture|message|메시지)$/i.test(label)) return undefined;
  return label.length <= 80 ? label : undefined;
}

export function mergeMessageWindows(
  existing: ChatMessage[],
  incoming: ChatMessage[],
  direction: "older" | "newer",
): ChatMessage[] {
  if (existing.length === 0) return inheritGroupedSenders(incoming);
  if (incoming.length === 0) return inheritGroupedSenders(existing);
  if (containsWindow(existing, incoming)) {
    return inheritGroupedSenders(enrichUnknownSenders(existing, incoming));
  }
  if (containsWindow(incoming, existing)) return inheritGroupedSenders(incoming);

  const olderOverlap = suffixPrefixOverlap(incoming, existing);
  const newerOverlap = suffixPrefixOverlap(existing, incoming);
  let merged: ChatMessage[];
  if (direction === "older") {
    if (olderOverlap > 0) merged = [...incoming.slice(0, -olderOverlap), ...existing];
    else if (newerOverlap > 0) merged = [...existing, ...incoming.slice(newerOverlap)];
    else merged = [...incoming, ...existing];
  } else if (newerOverlap > 0) {
    merged = [...existing, ...incoming.slice(newerOverlap)];
  } else if (olderOverlap > 0) {
    merged = [...incoming.slice(0, -olderOverlap), ...existing];
  } else {
    merged = [...existing, ...incoming];
  }
  return inheritGroupedSenders(enrichUnknownSenders(merged, incoming));
}

export function inheritGroupedSenders(messages: ChatMessage[]): ChatMessage[] {
  let lastExternalSender: string | undefined;
  const forwardFilled = messages.map((message) => {
    if (message.sender === "나") {
      lastExternalSender = undefined;
      return message;
    }
    if (message.sender !== "unknown") {
      lastExternalSender = message.sender;
      return message;
    }
    return lastExternalSender ? { ...message, sender: lastExternalSender } : message;
  });

  // Instagram attaches the avatar/profile link to either edge of a consecutive
  // message group depending on the current web layout. Fill from the following
  // labelled bubble as well, but never cross one of our own messages.
  let nextExternalSender: string | undefined;
  return forwardFilled.map((_, index) => {
    const message = forwardFilled[forwardFilled.length - 1 - index]!;
    if (message.sender === "나") {
      nextExternalSender = undefined;
      return message;
    }
    if (message.sender !== "unknown") {
      nextExternalSender = message.sender;
      return message;
    }
    return nextExternalSender ? { ...message, sender: nextExternalSender } : message;
  }).reverse();
}

function enrichUnknownSenders(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  return existing.map((message) => {
    if (message.sender !== "unknown") return message;
    const matches = incoming.filter(
      (candidate) =>
        candidate.sender !== "unknown" &&
        candidate.text === message.text &&
        candidate.timestamp === message.timestamp,
    );
    return matches.length === 1 ? { ...message, sender: matches[0]!.sender } : message;
  });
}

function containsWindow(haystack: ChatMessage[], needle: ChatMessage[]): boolean {
  if (needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((message, index) => sameMessage(message, haystack[start + index]!))) {
      return true;
    }
  }
  return false;
}

function suffixPrefixOverlap(left: ChatMessage[], right: ChatMessage[]): number {
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size > 0; size -= 1) {
    if (
      left.slice(-size).every((message, index) => sameMessage(message, right[index]!))
    ) {
      return size;
    }
  }
  return 0;
}

function sameMessage(left: ChatMessage, right: ChatMessage): boolean {
  const senderMatches =
    left.sender === right.sender || left.sender === "unknown" || right.sender === "unknown";
  return left.text === right.text && left.timestamp === right.timestamp && senderMatches;
}

function uniqueLines(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
