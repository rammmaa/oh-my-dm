import type {
  ChatMessage,
  Conversation,
  MessageKind,
  MessageReference,
} from "../domain.js";
import { normalizeMessageContent, parseReplyReference } from "../message-content.js";

export interface RawConversation {
  href: string;
  text: string;
  ariaLabel?: string | null;
  identity?: string;
}

export interface RawMessage {
  text: string;
  sender?: string | null;
  ariaLabel?: string | null;
  timestamp?: string | null;
  kind?: MessageKind;
  edited?: boolean;
  replyTo?: MessageReference;
  senderSource?: "display" | "profile";
  senderInferred?: boolean;
  senderIdentity?: string | null;
  visualTop?: number;
  visualBottom?: number;
  visualLeft?: number;
}

export function threadIdFromHref(href: string): string | undefined {
  if (/^button:\d+$/.test(href)) return href;
  return href.match(/\/direct\/t\/([^/?#]+)/)?.[1];
}

export function normalizeConversation(raw: RawConversation): Conversation | undefined {
  const id = threadIdFromHref(raw.href);
  if (!id) return undefined;
  const identity = raw.identity?.trim() || undefined;

  const lines = uniqueLines(raw.text);
  const title = lines[0] ?? `thread-${id.slice(0, 8)}`;
  const unreadText = `${raw.ariaLabel ?? ""} ${raw.text}`.toLowerCase();

  return {
    id,
    href: raw.href,
    ...(identity ? { identity } : {}),
    title,
    preview: lines.slice(1).join(" · ") || undefined,
    unread: /unread|읽지 않|새 메시지/.test(unreadText),
  };
}

export function stabilizeButtonConversationIds(
  items: Conversation[],
  previous: Conversation[] = [],
): Conversation[] {
  const titleOccurrences = new Map<string, number>();
  const identityOccurrences = new Map<string, number>();
  const signatureOccurrences = new Map<string, number>();
  for (const item of items) {
    if (item.identity) {
      identityOccurrences.set(item.identity, (identityOccurrences.get(item.identity) ?? 0) + 1);
    }
    const signature = conversationSignature(item);
    signatureOccurrences.set(signature, (signatureOccurrences.get(signature) ?? 0) + 1);
  }

  return items.map((item) => {
    if (!item.href.startsWith("button:")) return item;
    const identityIsUniqueInCurrent = Boolean(
      item.identity && identityOccurrences.get(item.identity) === 1,
    );
    const identityOwner = identityIsUniqueInCurrent
      ? previous.find((candidate) => candidate.identity === item.identity)
      : undefined;
    // React virtualizes the list and can briefly reuse a row element while its
    // old thread props are still attached. Never let that stale identity
    // overwrite a different conversation.
    const identityConflicts = Boolean(identityOwner && identityOwner.title !== item.title);
    const identityIsSafe = identityIsUniqueInCurrent && !identityConflicts;
    const previousByIdentity = identityIsSafe ? identityOwner : undefined;
    const signature = conversationSignature(item);
    const previousBySignature = signatureOccurrences.get(signature) === 1
      ? uniqueMatch(previous, (candidate) => conversationSignature(candidate) === signature)
      : undefined;
    const matched = previousByIdentity ?? previousBySignature;
    if (matched) {
      return {
        ...item,
        id: matched.id,
        ...(identityIsSafe ? {} : { identity: matched.identity }),
      };
    }
    if (identityIsSafe && item.identity) {
      return { ...item, id: `button-thread:${stableHash(item.identity)}` };
    }

    const occurrence = titleOccurrences.get(item.title) ?? 0;
    titleOccurrences.set(item.title, occurrence + 1);
    const { identity: _unstableIdentity, ...stableItem } = item;
    return {
      ...stableItem,
      id: `button-thread:${stableHash(`${item.title}\0${occurrence}`)}`,
    };
  });
}

export function restoreTransientConversationGaps(
  previous: Conversation[],
  current: Conversation[],
): Conversation[] {
  if (previous.length === 0 || current.length === 0) return current;

  const previousPositions = new Map(previous.map((item, index) => [item.id, index]));
  const currentPositions = current.map((item) => previousPositions.get(item.id));
  const isOrderedSubset = currentPositions.every(
    (position, index) =>
      position !== undefined && (index === 0 || position > currentPositions[index - 1]!),
  );
  if (isOrderedSubset) return mergeLoadedConversations(previous, current);

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

function conversationSignature(item: Conversation): string {
  return `${item.title}\0${item.preview ?? ""}`;
}

function uniqueMatch<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}

export function mergeLoadedConversations(
  existing: Conversation[],
  incoming: Conversation[],
): Conversation[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const merged = existing.map((item) => {
    const update = incomingById.get(item.id);
    return update && update.title === item.title ? update : item;
  });
  const existingIds = new Set(existing.map((item) => item.id));
  for (const item of incoming) {
    if (!existingIds.has(item.id)) merged.push(item);
  }
  return merged;
}

export function normalizeMessage(
  threadId: string,
  raw: RawMessage,
  index: number,
): ChatMessage | undefined {
  const content = normalizeMessageContent(uniqueLines(raw.text).join("\n"), raw.kind);
  if (!content) return undefined;

  const aria = raw.ariaLabel?.trim() ?? "";
  const sender =
    normalizeSenderLabel(raw.sender) ||
    normalizeSenderLabel(aria.match(/^([^,:]+)[,:]/)?.[1]) ||
    "unknown";
  const timestamp = raw.timestamp?.trim() || undefined;
  const replyTo = raw.replyTo ?? parseReplyReference(raw.sender) ?? parseReplyReference(aria);
  const kind = replyTo && content.kind === "text" ? "reply" : content.kind;
  const edited = raw.edited || content.edited || undefined;
  const replyFingerprint = replyTo ? `${replyTo.sender ?? ""}\0${replyTo.text ?? ""}` : "";
  const id = stableHash(
    `${threadId}\0${sender}\0${timestamp ?? ""}\0${kind}\0${content.text}\0${edited ? "1" : "0"}\0${replyFingerprint}\0${index}`,
  );

  return {
    id,
    threadId,
    kind,
    sender,
    ...(raw.senderInferred ? { senderInferred: true } : {}),
    text: content.text,
    timestamp,
    ...(edited ? { edited: true } : {}),
    ...(replyTo ? { replyTo } : {}),
  };
}

export function normalizeSenderLabel(value?: string | null): string | undefined {
  const label = value?.replaceAll("\u00a0", " ").trim();
  if (!label) return undefined;
  if (
    /^(?:(?:19|20)\d{2}\.\s*)?\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2}$/.test(label) ||
    /^(?:오늘|어제)\s+(?:오전|오후)\s+\d{1,2}:\d{2}$/.test(label)
  ) return undefined;

  const patterns = [
    /^(.+?)님의? 프로필 사진$/,
    /^(.+?)님이 보낸 메시지(?:입니다)?$/,
    /^(.+?)님의? 프로필 페이지(?:를)? 열기$/,
    /^(.+?)의 프로필 페이지(?:를)? 열기$/,
    /^open the profile page of (.+)$/i,
    /^(.+?) replied to you$/i,
    /^(.+?) replied to .+$/i,
    /^(.+?)님이 회원님에게 답장했습니다$/,
    /^(.+?)님이 .+?님에게 보낸 답장$/,
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
  const matching = matchIncomingMessages(existing, incoming);
  const anchoredExisting = enrichMessages(existing, matching.byExistingIndex);
  // Never reorder history that has already been accepted. Instagram may
  // virtualize a historical DOM window as [recent anchor, older rows], or
  // return only scattered anchor rows. Direction tells us which side owns all
  // genuinely new rows; occurrence-aware matching prevents repeated messages
  // with identical text from being collapsed.
  const merged = mergeUnmatchedAroundAnchors(
    anchoredExisting,
    incoming,
    matching.matches,
    direction,
  );
  return repairReplyQuoteSenders(inheritGroupedSenders(merged));
}

export function messageWindowsShareAnchor(
  left: ChatMessage[],
  right: ChatMessage[],
): boolean {
  return left.some((message) => right.some((candidate) => sameMessage(message, candidate)));
}

export function repairReplyQuoteSenders(messages: ChatMessage[]): ChatMessage[] {
  const repaired = messages.map((message) => ({ ...message }));
  for (let replyIndex = 0; replyIndex < repaired.length; replyIndex += 1) {
    const reply = repaired[replyIndex]!;
    const target = reply.replyTo?.sender;
    if (reply.kind !== "reply" || !target) continue;

    let ownIndex = replyIndex - 1;
    while (ownIndex >= 0 && repaired[ownIndex]!.sender !== "나") ownIndex -= 1;
    if (ownIndex < 0 || replyIndex - ownIndex > 6) continue;

    for (let quoteIndex = ownIndex - 1; quoteIndex >= Math.max(0, ownIndex - 6); quoteIndex -= 1) {
      const quote = repaired[quoteIndex]!;
      if (quote.sender === "나") break;
      if (quote.text !== reply.text || quote.sender !== reply.sender) continue;
      const precedingSender = repaired
        .slice(Math.max(0, quoteIndex - 4), quoteIndex)
        .reverse()
        .find((message) => message.sender !== "나" && message.sender !== "unknown")?.sender;
      if (precedingSender !== target) continue;
      const { replyTo: _replyTo, ...plainQuote } = quote;
      repaired[quoteIndex] = {
        ...plainQuote,
        kind: "text",
        sender: target,
        senderInferred: true,
      };
      break;
    }
  }
  return repaired;
}

function matchIncomingMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): {
  matches: Array<{ existingIndex: number; incomingIndex: number }>;
  byExistingIndex: Map<number, ChatMessage>;
} {
  const rows = incoming.length + 1;
  const columns = existing.length + 1;
  const scores = Array.from({ length: rows }, () => new Int32Array(columns));

  for (let incomingIndex = 1; incomingIndex < rows; incomingIndex += 1) {
    for (let existingIndex = 1; existingIndex < columns; existingIndex += 1) {
      const message = incoming[incomingIndex - 1]!;
      const candidate = existing[existingIndex - 1]!;
      let score = Math.max(
        scores[incomingIndex - 1]![existingIndex]!,
        scores[incomingIndex]![existingIndex - 1]!,
      );
      if (sameMessage(candidate, message)) {
        score = Math.max(
          score,
          scores[incomingIndex - 1]![existingIndex - 1]! + 100 + messageMatchQuality(candidate, message),
        );
      }
      scores[incomingIndex]![existingIndex] = score;
    }
  }

  const matches: Array<{ existingIndex: number; incomingIndex: number }> = [];
  let incomingIndex = incoming.length;
  let existingIndex = existing.length;
  while (incomingIndex > 0 && existingIndex > 0) {
    const message = incoming[incomingIndex - 1]!;
    const candidate = existing[existingIndex - 1]!;
    const diagonalScore = sameMessage(candidate, message)
      ? scores[incomingIndex - 1]![existingIndex - 1]! + 100 + messageMatchQuality(candidate, message)
      : -1;
    if (diagonalScore === scores[incomingIndex]![existingIndex]) {
      matches.push({ existingIndex: existingIndex - 1, incomingIndex: incomingIndex - 1 });
      incomingIndex -= 1;
      existingIndex -= 1;
    } else if (
      scores[incomingIndex - 1]![existingIndex]! >=
      scores[incomingIndex]![existingIndex - 1]!
    ) {
      incomingIndex -= 1;
    } else {
      existingIndex -= 1;
    }
  }
  matches.reverse();

  const byExistingIndex = new Map<number, ChatMessage>();
  for (const match of matches) {
    byExistingIndex.set(match.existingIndex, incoming[match.incomingIndex]!);
  }
  return { matches, byExistingIndex };
}

function messageMatchQuality(candidate: ChatMessage, message: ChatMessage): number {
  return (
    (candidate.sender === message.sender ? 8 : 0) +
    (candidate.kind === message.kind ? 4 : 0) +
    (candidate.replyTo?.sender === message.replyTo?.sender ? 2 : 0) +
    (candidate.timestamp && candidate.timestamp === message.timestamp ? 1 : 0)
  );
}

function mergeUnmatchedAroundAnchors(
  existing: ChatMessage[],
  incoming: ChatMessage[],
  matches: Array<{ existingIndex: number; incomingIndex: number }>,
  direction: "older" | "newer",
): ChatMessage[] {
  if (matches.length === 0) {
    return direction === "older" ? [...incoming, ...existing] : [...existing, ...incoming];
  }

  const matchedIncomingIndexes = new Set(matches.map((match) => match.incomingIndex));
  const insertBefore = new Map<number, ChatMessage[]>();
  const prepend: ChatMessage[] = [];
  const append: ChatMessage[] = [];

  for (let index = 0; index < incoming.length; index += 1) {
    if (matchedIncomingIndexes.has(index)) continue;
    const message = incoming[index]!;
    let previousMatch: { existingIndex: number; incomingIndex: number } | undefined;
    for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
      if (matches[matchIndex]!.incomingIndex < index) {
        previousMatch = matches[matchIndex];
        break;
      }
    }
    const nextMatch = matches.find((match) => match.incomingIndex > index);

    if (previousMatch && nextMatch) {
      const items = insertBefore.get(nextMatch.existingIndex) ?? [];
      items.push(message);
      insertBefore.set(nextMatch.existingIndex, items);
    } else if (direction === "older" || nextMatch) {
      // Instagram sometimes exposes [recent anchors, older rows]. A trailing
      // unmatched block during an older read therefore still belongs before
      // the accepted history, while leading rows are ordinary older content.
      prepend.push(message);
    } else {
      append.push(message);
    }
  }

  const merged = [...prepend];
  for (let index = 0; index < existing.length; index += 1) {
    merged.push(...(insertBefore.get(index) ?? []), existing[index]!);
  }
  merged.push(...append);
  return merged;
}

export function inheritGroupedSenders(messages: ChatMessage[]): ChatMessage[] {
  let lastExternalSender: string | undefined;
  return messages.map((message) => {
    if (message.sender === "나") {
      lastExternalSender = undefined;
      return message;
    }
    if (message.sender !== "unknown" && !message.senderInferred) {
      lastExternalSender = message.sender;
      return message;
    }
    return lastExternalSender
      ? { ...message, sender: lastExternalSender, senderInferred: true }
      : message;
  });
}

function enrichMessages(
  existing: ChatMessage[],
  matchedByIndex: Map<number, ChatMessage>,
): ChatMessage[] {
  return existing.map((message, index) => {
    const candidate = matchedByIndex.get(index);
    if (!candidate) return message;
    return {
      ...message,
      ...(message.kind === "text" && candidate.kind === "reply"
        ? { kind: "reply" as const }
        : {}),
      ...(!message.replyTo && candidate.replyTo ? { replyTo: candidate.replyTo } : {}),
      ...(!message.edited && candidate.edited ? { edited: true } : {}),
    };
  });
}

function sameMessage(left: ChatMessage, right: ChatMessage): boolean {
  const senderMatches = Boolean(
    left.sender === right.sender ||
    left.sender === "unknown" ||
    right.sender === "unknown" ||
    left.senderInferred ||
    right.senderInferred,
  );
  const kindMatches =
    left.kind === right.kind ||
    (left.kind === "text" && right.kind === "reply") ||
    (left.kind === "reply" && right.kind === "text");
  return (
    kindMatches &&
    left.text === right.text &&
    left.timestamp === right.timestamp &&
    senderMatches
  );
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
