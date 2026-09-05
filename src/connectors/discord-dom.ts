import type { ChatMessage, Conversation, MessageKind, MessageReference } from "../domain.js";

export interface DiscordRoute {
  login: boolean;
  guildId?: string;
  channelId?: string;
}

export interface RawDiscordDmRow {
  href: string;
  label: string | null;
  name: string;
  unread: boolean;
}

export interface RawDiscordGuildRow {
  id: string;
  name: string;
  folder: boolean;
  expanded?: boolean;
  unread: boolean;
}

export interface RawDiscordChannelRow {
  href: string;
  label: string | null;
  name: string;
  unread: boolean;
}

export interface RawDiscordForumPost {
  id: string;
  title: string;
  unread: boolean;
}

export interface RawDiscordMessage {
  id: string;
  channelId: string;
  sender: string | null;
  own: boolean;
  timestamp: string | null;
  text: string;
  kind: MessageKind;
  edited: boolean;
  // True while Discord is still sending the message (optimistic render). Such
  // a row carries a temporary id and is replaced by the real one once the
  // server acks, so callers should drop it to avoid showing it twice.
  pending?: boolean;
  replyTo?: MessageReference;
}

export interface DiscordCurrentUser {
  id?: string;
  displayName?: string;
}

// Discord localizes the channel type inside the trailing parentheses of the
// accessible label, and the language can even be mixed ("아파트 (forum channel)").
const NON_TEXT_CHANNEL_PATTERN =
  /\([^()]*(?:음성|voice|스테이지|stage|포럼|forum|미디어|media)[^()]*\)(?:,.*)?$/i;

export function parseDiscordRoute(url: string): DiscordRoute {
  let pathname = url;
  try {
    pathname = new URL(url, "https://discord.com").pathname;
  } catch {
    // Keep the raw value when it is not a URL.
  }
  if (/^\/login(?:\/|$)/.test(pathname)) return { login: true };
  const match = pathname.match(/^\/channels\/(@me|\d+)(?:\/(\d+))?/);
  if (!match) return { login: false };
  const guildId = match[1] === "@me" ? undefined : match[1];
  return {
    login: false,
    ...(guildId ? { guildId } : {}),
    ...(match[2] ? { channelId: match[2] } : {}),
  };
}

// "이협 (다이렉트 메시지), 온라인" → "이협". Only the last parenthetical is a
// type annotation; earlier ones belong to the name.
export function titleFromDiscordLabel(label: string | null | undefined, fallback: string): string {
  const cleaned = (label ?? "").replaceAll(" ", " ").trim();
  const stripped = cleaned.replace(/\s*\([^()]*\)(?:,.*)?$/, "").trim();
  return stripped || cleaned || fallback.replaceAll(" ", " ").trim();
}

export function isTextChannelLabel(label: string | null | undefined): boolean {
  if (!label) return true;
  return !NON_TEXT_CHANNEL_PATTERN.test(label.trim());
}

export function normalizeDiscordDmRow(raw: RawDiscordDmRow): Conversation | undefined {
  const channelId = raw.href.match(/^\/channels\/@me\/(\d+)/)?.[1];
  if (!channelId) return undefined;
  const title = titleFromDiscordLabel(raw.label, raw.name);
  if (!title) return undefined;
  return { id: channelId, title, href: `/channels/@me/${channelId}`, unread: raw.unread };
}

export function normalizeDiscordChannelRow(
  raw: RawDiscordChannelRow,
  guildName: string,
): Conversation | undefined {
  const match = raw.href.match(/^\/channels\/(\d+)\/(\d+)/);
  if (!match) return undefined;
  if (!isTextChannelLabel(raw.label)) return undefined;
  // The aria-label prefixes an unread channel with "읽지 않은", so prefer the
  // visible name node, which always holds the channel's real name.
  const channelName = raw.name.trim() || titleFromDiscordLabel(raw.label, raw.name);
  if (!channelName) return undefined;
  const guild = guildName.trim();
  return {
    id: match[2]!,
    identity: `guild:${match[1]}`,
    title: guild ? `${guild} #${channelName}` : `#${channelName}`,
    href: `/channels/${match[1]}/${match[2]}`,
    unread: raw.unread,
  };
}

// document.title reads "[•] [(N)] Discord | <name> | <server>" for a channel
// or thread, and "<name>" is wrapped in quotes for a thread or prefixed with
// "#" for a channel/forum. Pull the clean name out of it.
export function parseDiscordTitleName(title: string | null | undefined): string | null {
  let value = (title ?? "").replaceAll(" ", " ").trim();
  if (!value) return null;
  value = value.replace(/^[•\s]*/, "").replace(/^\(\d+\)\s*/, "").trim();
  const parts = value.split(" | ");
  let name = (parts.length >= 3 ? parts[1] : parts[0]) ?? "";
  name = name.replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, "").replace(/^#/, "").trim();
  if (!name || name === "Discord") return null;
  return name;
}

// A forum post is a thread, so its URL is a normal channel route and opening
// and sending reuse the channel path. Only the flat-list title differs.
export function normalizeDiscordForumPost(
  raw: RawDiscordForumPost,
  guildId: string,
  guildName: string,
  forumName: string,
): Conversation | undefined {
  if (!/^\d{15,}$/.test(raw.id)) return undefined;
  const post = raw.title.trim() || `\uae00 ${raw.id}`;
  const guild = guildName.trim();
  const forum = forumName.trim();
  const prefix = forum ? `${forum} \u203a ` : "";
  return {
    id: raw.id,
    identity: `guild:${guildId}`,
    title: guild ? `${guild} #${prefix}${post}` : `#${prefix}${post}`,
    href: `/channels/${guildId}/${raw.id}`,
    unread: raw.unread,
  };
}

export function normalizeDiscordMessage(
  raw: RawDiscordMessage,
  previousSender?: string,
): ChatMessage | undefined {
  const text = raw.text.replaceAll(" ", " ").trim();
  if (!text && raw.kind === "text") return undefined;
  const explicitSender = raw.own ? "나" : raw.sender?.trim() || undefined;
  const sender = explicitSender ?? previousSender ?? "unknown";
  const senderInferred = !explicitSender && Boolean(previousSender);
  const kind: MessageKind = raw.replyTo && raw.kind === "text" ? "reply" : raw.kind;
  return {
    id: raw.id,
    threadId: raw.channelId,
    kind,
    sender,
    ...(senderInferred ? { senderInferred: true } : {}),
    text,
    ...(raw.timestamp ? { timestamp: raw.timestamp } : {}),
    ...(raw.edited ? { edited: true } : {}),
    ...(raw.replyTo ? { replyTo: raw.replyTo } : {}),
  };
}

// Discord only renders a header for the first message of a group. Later rows
// inherit the sender from the closest header above them.
export function normalizeDiscordMessages(rows: RawDiscordMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let previousSender: string | undefined;
  for (const raw of rows) {
    const message = normalizeDiscordMessage(raw, previousSender);
    if (!message) continue;
    previousSender = message.sender;
    messages.push(message);
  }
  return messages;
}

// Discord ids are snowflakes: numeric strings that grow with time.
export function compareSnowflakes(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function mergeDiscordMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const sortedIncoming = [...incoming].sort((left, right) => compareSnowflakes(left.id, right.id));
  const incomingIds = new Set(sortedIncoming.map((message) => message.id));
  const first = sortedIncoming[0]!.id;
  const last = sortedIncoming[sortedIncoming.length - 1]!.id;
  // Rows inside the visible window that disappeared were deleted, or were
  // optimistic pending rows that Discord replaced with the real id.
  const kept = existing.filter(
    (message) =>
      incomingIds.has(message.id) ||
      compareSnowflakes(message.id, first) < 0 ||
      compareSnowflakes(message.id, last) > 0,
  );
  const byId = new Map(kept.map((message) => [message.id, message]));
  for (const message of sortedIncoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => compareSnowflakes(left.id, right.id));
}

// Keep the primary list's order and entries, then append anything only the
// secondary list knows about.
export function mergeDiscordConversations(
  primary: Conversation[],
  secondary: Conversation[],
): Conversation[] {
  const merged = [...primary];
  const seen = new Set(primary.map((item) => item.id));
  for (const item of secondary) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

// Keep the established order, refresh the rows that are currently rendered,
// and append rows seen for the first time. Used when a virtualized list only
// shows a window of the rows already known.
export function updateDiscordConversations(
  existing: Conversation[],
  incoming: Conversation[],
): Conversation[] {
  const fresh = new Map(incoming.map((item) => [item.id, item]));
  const updated = existing.map((item) => fresh.get(item.id) ?? item);
  const seen = new Set(existing.map((item) => item.id));
  for (const item of incoming) {
    if (!seen.has(item.id)) updated.push(item);
  }
  return updated;
}

// The readers below run inside Playwright evaluate callbacks. Keep them
// self-contained: no imports and no named inner functions, because tsx can
// rewrite those to call a module-scoped __name helper that the browser lacks.

export function readDiscordDmRows(elements: Element[]): RawDiscordDmRow[] {
  return elements.flatMap((element) => {
    const href = element.getAttribute("href") ?? "";
    if (!/^\/channels\/@me\/\d+/.test(href)) return [];
    const node = element as HTMLElement;
    const nameNode = node.querySelector<HTMLElement>('[class*="name_"]');
    const badge = [...node.querySelectorAll<HTMLElement>('[class*="badge"], [class*="Badge"]')]
      .find((candidate) => /^\d+$/.test(candidate.textContent?.trim() ?? ""));
    return [{
      href,
      label: element.getAttribute("aria-label"),
      name: (nameNode?.textContent ?? node.textContent ?? "").replaceAll(" ", " ").trim(),
      unread: Boolean(badge),
    }];
  });
}

export function readDiscordGuildRows(elements: Element[]): RawDiscordGuildRow[] {
  return elements.flatMap((element) => {
    const id = (element.getAttribute("data-list-item-id") ?? "").replace(/^guildsnav___/, "");
    // Skip "home" and the add/discover/download buttons that share the list.
    if (!/^\d+$/.test(id)) return [];
    const node = element as HTMLElement;
    const named =
      node.closest<HTMLElement>("[data-dnd-name]") ??
      node.querySelector<HTMLElement>("[data-dnd-name]");
    const folderButton = node.matches('[class*="folderButton"]')
      ? node
      : node.querySelector<HTMLElement>('[class*="folderButton"]');
    // Guild ids are 17+ digit snowflakes; folder ids are short numbers.
    const folder = Boolean(folderButton) || !/^\d{15,}$/.test(id);
    const expanded = folderButton
      ? folderButton.getAttribute("aria-expanded") === "true"
      : undefined;
    // The unread pill is a sibling of the icon wrapper, both inside the list item.
    const container =
      node.closest<HTMLElement>('[class*="listItem"]') ??
      node.parentElement?.parentElement ??
      node.parentElement;
    const unread = Boolean(container?.querySelector('[class*="pill"] [class*="unread"]'));
    return [{
      id,
      name: (named?.getAttribute("data-dnd-name") ?? node.getAttribute("aria-label") ?? "").trim(),
      folder,
      ...(expanded !== undefined ? { expanded } : {}),
      unread,
    }];
  });
}

export function readDiscordChannelRows(elements: Element[]): RawDiscordChannelRow[] {
  return elements.flatMap((element) => {
    const href = element.getAttribute("href") ?? "";
    if (!/^\/channels\/\d+\/\d+/.test(href)) return [];
    const node = element as HTMLElement;
    const row = node.closest<HTMLElement>("li") ?? node;
    const nameNode = node.querySelector<HTMLElement>('[class*="name_"]');
    const badge = [...row.querySelectorAll<HTMLElement>('[class*="badge"], [class*="Badge"]')]
      .find((candidate) => /^\d+$/.test(candidate.textContent?.trim() ?? ""));
    return [{
      href,
      label: element.getAttribute("aria-label"),
      name: (nameNode?.textContent ?? node.textContent ?? "").replaceAll(" ", " ").trim(),
      unread: Boolean(row.querySelector('[class*="modeUnread"]')) || Boolean(badge),
    }];
  });
}

// Read the name of the channel or thread that is currently open. Used for
// pinned channels that never appear in the sidebar list (forum posts), so the
// list can show a real name instead of a raw id. Runs inside evaluate, so it
// stays self-contained with no imports or named inner functions.
export function readDiscordOpenChannelName(): string | null {
  const composer = document.querySelector('[data-slate-editor="true"]');
  const composerLabel = composer?.getAttribute("aria-label") ?? "";
  let name = composerLabel
    .replace(/^Message\s+/i, "")
    .replace(/에 메시지 보내기$/u, "")
    .trim()
    .replace(/^#/, "")
    .trim();
  if (!name) {
    const title = (document.title || "")
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*[|-]\s*Discord\s*$/i, "")
      .trim();
    name = (title.split(" | ")[0] ?? title).replace(/^#/, "").trim();
  }
  return name || null;
}

// The channel sidebar is a <nav aria-label="술코 (서버)">.
export function readDiscordSidebarGuildName(element: Element): string | null {
  const label = element.closest("nav")?.getAttribute("aria-label") ?? null;
  if (!label) return null;
  const stripped = label.replaceAll(" ", " ").replace(/\s*\([^()]*\)\s*$/, "").trim();
  return stripped || null;
}

export function readDiscordForumPosts(elements: Element[]): RawDiscordForumPost[] {
  return elements.flatMap((element) => {
    const id = element.getAttribute("data-item-id") ?? "";
    if (!/^\d{15,}$/.test(id)) return [];
    const node = element as HTMLElement;
    const titleNode = node.querySelector<HTMLElement>('[class*="postTitle"]');
    const title = (titleNode?.textContent ?? "").replaceAll(" ", " ").replace(/\s+/g, " ").trim();
    const unread = Boolean(node.querySelector('[class*="hasUnreads"]'));
    return [{ id, title, unread }];
  });
}

export function readDiscordCurrentUser(element: Element): DiscordCurrentUser {
  const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
  let fiber = fiberKey
    ? (element as unknown as Record<string, {
        memoizedProps?: Record<string, unknown>;
        return?: unknown;
      }>)[fiberKey]
    : undefined;
  for (let depth = 0; fiber && depth < 20; depth += 1) {
    const props = fiber.memoizedProps;
    const user = (props?.user ?? props?.currentUser) as
      | { id?: unknown; globalName?: unknown; username?: unknown }
      | undefined;
    if (user && typeof user === "object" && user.id !== undefined) {
      const displayName =
        typeof user.globalName === "string" && user.globalName
          ? user.globalName
          : typeof user.username === "string"
            ? user.username
            : undefined;
      return { id: String(user.id), ...(displayName ? { displayName } : {}) };
    }
    fiber = fiber.return as typeof fiber;
  }
  const text = (element as HTMLElement).innerText.split("\n")[0]?.trim();
  return text ? { displayName: text } : {};
}

export function readDiscordMessageRows(
  elements: Element[],
  myUserId: string | null,
): RawDiscordMessage[] {
  return elements.flatMap((element) => {
    const match = element.id.match(/^chat-messages-(\d+)-(\d+)$/);
    if (!match) return [];
    const node = element as HTMLElement;

    // The author id and message type are not in the DOM. Read them from the
    // React props of the row, the same way the Instagram connector reads
    // thread ids. Everything shown to the user still comes from the DOM.
    let authorId: string | undefined;
    let messageType: number | undefined;
    let messageState: string | undefined;
    const fiberKey = Object.keys(node).find((key) => key.startsWith("__reactFiber$"));
    let fiber = fiberKey
      ? (node as unknown as Record<string, {
          memoizedProps?: Record<string, unknown>;
          return?: unknown;
        }>)[fiberKey]
      : undefined;
    for (let depth = 0; fiber && depth < 8; depth += 1) {
      const message = fiber.memoizedProps?.message as
        | { author?: { id?: unknown }; type?: unknown; state?: unknown }
        | undefined;
      if (message && typeof message === "object") {
        if (message.author && message.author.id !== undefined) authorId = String(message.author.id);
        if (typeof message.type === "number") messageType = message.type;
        if (typeof message.state === "string") messageState = message.state;
        break;
      }
      fiber = fiber.return as typeof fiber;
    }

    // Type 0 is a normal message and 19 is a reply; everything else is a
    // system notice such as "joined the server" or "pinned a message".
    const isSystem = messageType !== undefined && messageType !== 0 && messageType !== 19;
    const replyContext = node.querySelector<HTMLElement>('[id^="message-reply-context-"]');
    const content = [...node.querySelectorAll<HTMLElement>('[id^="message-content-"]')]
      .find((candidate) => !replyContext || !replyContext.contains(candidate));

    // Walk the visible text by hand: Discord renders emoji as <img alt="…">,
    // and the "(edited)" marker and timestamps live inside the content node.
    const parts: string[] = [];
    const root = isSystem ? node : content;
    const stack: Node[] = root ? [root] : [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.nodeType === Node.TEXT_NODE) {
        parts.push(current.textContent ?? "");
        continue;
      }
      if (!(current instanceof HTMLElement)) continue;
      if (current instanceof HTMLTimeElement) continue;
      if (/edited|timestamp/i.test(current.className)) continue;
      if (current instanceof HTMLImageElement) {
        parts.push(current.getAttribute("alt") ?? "");
        continue;
      }
      if (current instanceof HTMLBRElement) {
        parts.push("\n");
        continue;
      }
      const children = [...current.childNodes];
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!);
    }
    const text = isSystem
      ? parts.join(" ").replaceAll(" ", " ").replace(/\s+/g, " ").trim()
      : parts.join("").replaceAll(" ", " ").trim();

    const hasVideo = Boolean(node.querySelector("video"));
    const hasImage = Boolean(node.querySelector('[class*="imageWrapper"], img[class*="lazyImg"]'));
    const hasSticker = Boolean(node.querySelector('[class*="sticker"]'));
    const hasEmbed = Boolean(node.querySelector("article"));
    const hasAttachment = Boolean(node.querySelector('[class*="ttachment"]'));
    const kind: MessageKind = isSystem
      ? "system"
      : text
        ? "text"
        : hasVideo
          ? "video"
          : hasImage
            ? "image"
            : hasSticker
              ? "sticker"
              : hasEmbed
                ? "post"
                : hasAttachment
                  ? "image"
                  : "text";

    // The header span also carries a server tag chiplet ("서버 태그: PSPS");
    // only the inner username element holds the display name.
    const headerNode = node.querySelector<HTMLElement>('[id^="message-username-"]');
    const usernameNode = headerNode?.querySelector<HTMLElement>('[class*="username"]') ?? headerNode;
    const timeNode = node.querySelector("time[datetime]");
    const replyQuoteNode = replyContext?.querySelector<HTMLElement>('[id^="message-content-"]');
    const replyText = replyQuoteNode?.textContent?.replaceAll(" ", " ").trim();
    const replyUsernameNode = replyContext?.querySelector<HTMLElement>('[class*="username"]');
    const replySenderRaw = replyUsernameNode
      ? replyUsernameNode.textContent ?? ""
      : (replyContext?.textContent ?? "").replace(replyText ?? "", "");
    const replySender = replySenderRaw.replaceAll(" ", " ").trim().replace(/^@/, "").trim();
    // A received message has state "SENT" (or none). Anything else, such as
    // "SENDING", is an optimistic row that will be re-read with its real id.
    const pending = messageState !== undefined && messageState !== "SENT";
    return [{
      id: match[2]!,
      channelId: match[1]!,
      sender: usernameNode
        ? (usernameNode.textContent ?? "").replaceAll(" ", " ").trim()
        : null,
      own: Boolean(myUserId && authorId && authorId === myUserId),
      timestamp: timeNode?.getAttribute("datetime") ?? null,
      text,
      kind,
      edited: Boolean(node.querySelector('[class*="edited"]')),
      ...(pending ? { pending: true } : {}),
      ...(replyContext
        ? {
            replyTo: {
              ...(replySender ? { sender: replySender } : {}),
              ...(replyText ? { text: replyText } : {}),
            },
          }
        : {}),
    }];
  });
}
