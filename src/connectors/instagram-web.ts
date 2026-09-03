import { EventEmitter } from "node:events";
import fs from "node:fs/promises";

import { chromium, type BrowserContext, type Page } from "playwright-core";

import { resolveBrowserExecutable } from "../browser/resolve-browser.js";
import type {
  ChatConnector,
  ChatMessage,
  ChatSnapshot,
  Conversation,
} from "../domain.js";
import {
  normalizeConversation,
  mergeLoadedConversations,
  mergeMessageWindows,
  normalizeMessage,
  restoreTransientConversationGaps,
  stabilizeButtonConversationIds,
  type RawConversation,
  type RawMessage,
} from "./instagram-dom.js";

const INBOX_URL = "https://www.instagram.com/direct/inbox/";
// Instagram localizes this element's accessible name (for example,
// "Thread list" and "대화 리스트"). Its structural role is stable across
// locales, so conversation discovery must not depend on the label text.
const THREAD_LIST_SELECTOR = 'main [role="navigation"]';
const THREAD_ROW_SELECTOR = `${THREAD_LIST_SELECTOR} [role="button"]`;

interface ConversationRowTarget {
  index: number;
  title: string;
  preview?: string;
  identity?: string;
}

// Keep this as a top-level, self-contained browser callback. Functions created
// inside evaluateAll callbacks can be rewritten by tsx/esbuild to call its
// module-scoped __name helper, which does not exist in the browser context.
export function clickInstagramConversationRow(
  elements: Element[],
  target: ConversationRowTarget,
): void {
  const rows = elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    const parts = [...new Set(
      [...element.querySelectorAll("span")]
        .map((part) => part.textContent?.replaceAll("\u00a0", " ").trim())
        .filter((part): part is string => Boolean(part)),
    )];
    const text = parts.length >= 2
      ? parts.join("\n")
      : (element as HTMLElement).innerText.trim();
    return (
      text.length > 0 &&
      rect.x < 500 &&
      rect.width > 300 &&
      rect.height >= 48 &&
      rect.height <= 110
    );
  });
  const normalizedTitle = target.title.replaceAll("\u00a0", " ").trim();
  const previewLead = target.preview
    ?.replaceAll("\u00a0", " ")
    .split(" · ")[0]
    ?.trim();
  const titleMatches = rows.filter((element) => {
    const parts = [...new Set(
      [...element.querySelectorAll("span")]
        .map((part) => part.textContent?.replaceAll("\u00a0", " ").trim())
        .filter((part): part is string => Boolean(part)),
    )];
    return parts[0] === normalizedTitle;
  });
  let identityMatch: Element | undefined;
  if (target.identity) {
    for (const element of titleMatches) {
      const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
      let fiber = fiberKey
        ? (element as unknown as Record<string, {
            memoizedProps?: Record<string, unknown>;
            return?: unknown;
          }>)[fiberKey]
        : undefined;
      for (let depth = 0; fiber && depth < 12; depth += 1) {
        const props = fiber.memoizedProps;
        const threadKey = props?.threadKeyForSelection ?? props?.threadFbidForSelection;
        if (`thread:${String(threadKey)}` === target.identity) {
          identityMatch = element;
          break;
        }
        fiber = fiber.return as typeof fiber;
      }
      if (identityMatch) break;
    }
  }
  const matched = identityMatch ?? titleMatches.find((element) => {
    if (!previewLead) return true;
    const text = (element.textContent ?? "").replaceAll("\u00a0", " ");
    return text.includes(previewLead);
  }) ?? (titleMatches.length === 1 ? titleMatches[0] : rows[target.index]);
  if (!(matched instanceof HTMLElement)) throw new Error("대화 행을 찾지 못했습니다.");
  matched.click();
}

export function readInstagramMessageRows(elements: Element[]): RawMessage[] {
  return elements
    .map((element) => {
      const node = element as HTMLElement;
      const text = node.innerText ?? "";
      const containers: HTMLElement[] = [];
      let container: HTMLElement | null = node;
      for (let depth = 0; depth < 10 && container; depth += 1) {
        containers.push(container);
        container = container.parentElement;
      }

      const reelLink = node.matches('a[href*="/reel/"]')
        ? node
        : node.closest<HTMLElement>('a[href*="/reel/"]') ??
          node.querySelector<HTMLElement>('a[href*="/reel/"]');
      let inlineShare = false;
      let sharedTargetUrl = "";
      const fiberContainers = [
        node,
        ...node.querySelectorAll<HTMLElement>("*"),
      ].slice(0, 100);
      for (const candidateContainer of fiberContainers) {
        const fiberKey = Object.keys(candidateContainer).find((key) =>
          key.startsWith("__reactFiber$") || key.startsWith("__reactProps$"),
        );
        if (!fiberKey) continue;
        const root = (candidateContainer as unknown as Record<string, unknown>)[fiberKey];
        const fiberQueue: Array<{ value: unknown; depth: number }> = [
          { value: root, depth: 0 },
        ];
        const visitedFibers = new WeakSet<object>();
        for (let fiberIndex = 0; fiberIndex < fiberQueue.length && fiberIndex < 60; fiberIndex += 1) {
          const fiberEntry = fiberQueue[fiberIndex]!;
          const fiberValue = fiberEntry.value;
          if (!fiberValue || typeof fiberValue !== "object" || visitedFibers.has(fiberValue)) continue;
          visitedFibers.add(fiberValue);
          const fiber = fiberValue as Record<string, unknown>;
          const propsQueue: Array<{ value: unknown; depth: number }> = [
            { value: fiber.memoizedProps, depth: 0 },
            { value: fiber.pendingProps, depth: 0 },
          ];
          const visitedProps = new WeakSet<object>();
          for (let propIndex = 0; propIndex < propsQueue.length && propIndex < 120; propIndex += 1) {
            const entry = propsQueue[propIndex]!;
            if (!entry.value || typeof entry.value !== "object" || visitedProps.has(entry.value)) continue;
            try {
              if (entry.value instanceof Node || entry.value instanceof Window) continue;
            } catch {
              continue;
            }
            visitedProps.add(entry.value);
            const record = entry.value as Record<string, unknown>;
            try {
              if (record.content_type === "MESSAGE_INLINE_SHARE") inlineShare = true;
              if (typeof record.targetUrl === "string") sharedTargetUrl = record.targetUrl;
            } catch {
              continue;
            }
            if (entry.depth >= 4) continue;
            try {
              for (const value of Object.values(record)) {
                if (
                  value &&
                  typeof value === "object" &&
                  !(value instanceof Node) &&
                  !(value instanceof Window)
                ) {
                  propsQueue.push({ value, depth: entry.depth + 1 });
                }
              }
            } catch {
              continue;
            }
          }
          if (fiberEntry.depth < 5 && fiber.child) {
            fiberQueue.push({ value: fiber.child, depth: fiberEntry.depth + 1 });
          }
          // The root fiber's sibling belongs to the next DOM message. Only
          // inspect siblings below the current card's own child tree.
          if (fiberEntry.depth > 0 && fiber.sibling) {
            fiberQueue.push({ value: fiber.sibling, depth: fiberEntry.depth });
          }
          if (inlineShare && sharedTargetUrl) break;
        }
        if (inlineShare && sharedTargetUrl) break;
      }
      const isReel = Boolean(
        reelLink ||
        (inlineShare && (
          /instagram\.com\/reel\//i.test(sharedTargetUrl) ||
          /instagram\.com\/p\//i.test(sharedTargetUrl) &&
            /(?:carousel_share_child_media_id|is_ineligible_for_clips_chaining=false)/i.test(sharedTargetUrl)
        )),
      );
      const reelTitle = isReel && reelLink
        ? [
            reelLink.getAttribute("aria-label"),
            reelLink.getAttribute("title"),
          ]
            .map((candidate) => candidate?.replaceAll("\u00a0", " ").trim())
            .find((candidate): candidate is string => Boolean(
              candidate &&
              candidate.length <= 240 &&
              !/^[a-z0-9._]+$/i.test(candidate) &&
              !/^(?:릴스|reel|reels|watch reel|original audio)$/i.test(candidate) &&
              !/(?:님의 릴스|(?:'s|’s) reel|reel by .+)$/i.test(candidate),
            ))
        : undefined;
      const displayText = isReel
        ? reelTitle
          ? `${reelTitle.replace(/\s*\(릴스\)$/, "")}(릴스)`
          : "(릴스)"
        : text;
      const ownLabel = element.getAttribute("aria-label");
      let sender: string | null = null;
      let senderSource: "display" | "profile" | undefined;

      // Instagram can expose the account ID in an avatar label while showing
      // the user's chosen display name above the same message group. Search
      // every visible ancestor first so one person is not rendered under two
      // names within a consecutive group.
      for (const candidateContainer of containers) {
        const lines = [...new Set(
          candidateContainer.innerText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        )];
        if (lines.length >= 2 && lines[0] !== text.trim() && lines[0]!.length <= 80) {
          sender = lines[0]!;
          senderSource = "display";
          break;
        }
      }

      if (!sender) {
        for (const candidateContainer of containers) {
          const labels = [
            ...candidateContainer.querySelectorAll<HTMLElement>('img[alt], [aria-label], [title]'),
          ].flatMap((candidate) => [
            candidate.getAttribute("alt"),
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("title"),
          ]);
          sender = labels.find((label): label is string =>
            Boolean(
              label &&
              label !== ownLabel &&
              label.length <= 120 &&
              (/프로필 사진|profile picture|보낸 메시지|프로필 페이지|open the profile page of/i.test(label)),
            ),
          ) ?? null;
          if (sender) {
            senderSource = "profile";
            break;
          }
        }
      }

      return {
        text: displayText,
        sender,
        ariaLabel: ownLabel,
        timestamp: element.querySelector("time")?.getAttribute("datetime"),
        ...(isReel ? { kind: "reel" as const } : {}),
        ...(senderSource ? { senderSource } : {}),
      };
    })
    .filter((item) => item.text.trim().length > 0);
}

export interface InstagramWebOptions {
  profileDir: string;
  headless?: boolean;
}

export class InstagramWebConnector extends EventEmitter implements ChatConnector {
  private context?: BrowserContext;
  private page?: Page;
  private refreshTimer?: NodeJS.Timeout;
  private refreshRunning = false;
  private refreshAgain = false;
  private lastFingerprint = "";
  private browserLabel = "Chromium";
  private activeConversationOverride?: string;
  private loadingOlder = false;
  private preserveLoadedConversations = false;
  private stopped = false;
  private readonly messageHistory = new Map<string, ChatMessage[]>();
  private snapshot: ChatSnapshot = {
    state: "starting",
    conversations: [],
    messages: [],
    detail: "브라우저 엔진을 시작하는 중",
  };

  public constructor(private readonly options: InstagramWebOptions) {
    super();
  }

  public getSnapshot(): ChatSnapshot {
    return this.snapshot;
  }

  public async refresh(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    await this.performRefresh();
  }

  public async loadOlderMessages(): Promise<number> {
    const page = this.requirePage();
    const threadId = page.url().match(/\/direct\/t\/([^/?#]+)/)?.[1];
    if (!threadId) return 0;

    while (this.refreshRunning) await page.waitForTimeout(50);
    const previousCount = this.messageHistory.get(threadId)?.length ?? this.snapshot.messages.length;
    // Set this before scrolling because the DOM observer can refresh as soon
    // as Instagram inserts virtualized older rows. Marking it afterwards lets
    // that first refresh append old messages as if they were new.
    this.loadingOlder = true;
    try {
      const moved = await page.locator("main").evaluate((main): boolean => {
        const candidates = [...main.querySelectorAll<HTMLElement>("div")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return (
              rect.width > 280 &&
              rect.height > 180 &&
              rect.left > window.innerWidth * 0.3 &&
              element.scrollHeight > element.clientHeight + 30 &&
              /(auto|scroll)/.test(style.overflowY)
            );
          })
          .sort((left, right) => left.clientWidth * left.clientHeight - right.clientWidth * right.clientHeight);
        const scroller = candidates[0];
        if (!scroller) return false;
        const before = scroller.scrollTop;
        const amount = Math.max(400, Math.floor(scroller.clientHeight * 0.8));
        scroller.scrollBy({ top: -amount, behavior: "instant" });
        if (scroller.scrollTop === before && before === 0) {
          scroller.scrollTop = -amount;
        }
        return scroller.scrollTop !== before;
      }).catch(() => false);
      if (!moved) return 0;

      await page.waitForTimeout(450);
      await this.performRefresh();
      return Math.max(0, (this.messageHistory.get(threadId)?.length ?? 0) - previousCount);
    } finally {
      this.loadingOlder = false;
    }
  }

  public async loadMoreConversations(): Promise<number> {
    const page = this.requirePage();
    while (this.refreshRunning) await page.waitForTimeout(50);
    const previousCount = this.snapshot.conversations.length;
    // Scrolling virtualizes the top rows and emits DOM wake events before this
    // method's explicit refresh. Preserve the captured order from that first
    // event onward, otherwise temporarily missing rows can be discarded.
    this.preserveLoadedConversations = true;
    const moved = await page.locator(THREAD_LIST_SELECTOR).evaluate((threadList): boolean => {
      const candidates = [threadList, ...threadList.querySelectorAll<HTMLElement>("div")]
        .filter((element): element is HTMLElement => element instanceof HTMLElement)
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.clientHeight > 120 &&
            element.scrollHeight > element.clientHeight + 20 &&
            /(auto|scroll)/.test(style.overflowY)
          );
        })
        .sort((left, right) => left.clientWidth * left.clientHeight - right.clientWidth * right.clientHeight);
      const scroller = candidates[0];
      if (!scroller) return false;
      const before = scroller.scrollTop;
      scroller.scrollBy({
        top: Math.max(300, Math.floor(scroller.clientHeight * 0.8)),
        behavior: "instant",
      });
      return scroller.scrollTop !== before;
    }).catch(() => false);
    if (!moved) return 0;

    await page.waitForTimeout(450);
    await this.performRefresh();
    return Math.max(0, this.snapshot.conversations.length - previousCount);
  }

  public async start(): Promise<void> {
    this.stopped = false;
    await fs.mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    const headless = this.options.headless ?? true;
    const browser = resolveBrowserExecutable();
    this.browserLabel = `${browser.label}${headless ? " Headless" : ""}`;
    this.context = await chromium.launchPersistentContext(this.options.profileDir, {
      executablePath: browser.executablePath,
      headless,
      viewport: { width: 1100, height: 780 },
    });
    if (this.stopped) {
      await this.context.close();
      this.context = undefined;
      return;
    }

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.installWakeSignals(this.page);
    await this.page.goto(INBOX_URL, { waitUntil: "domcontentloaded" });
    this.scheduleRefresh("startup", 0);
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }

  public async openConversation(id: string): Promise<void> {
    const page = this.requirePage();
    const conversation = this.snapshot.conversations.find((item) => item.id === id);
    if (!conversation) throw new Error(`대화를 찾을 수 없습니다: ${id}`);
    const previousOverride = this.activeConversationOverride;
    const previousUrl = page.url();

    // Pin the target before clicking. Instagram emits DOM wake events during
    // navigation, and a refresh triggered in that window must never reuse the
    // previously opened conversation id.
    this.activeConversationOverride = id;

    if (conversation.href.startsWith("button:")) {
      const index = Number(conversation.href.slice("button:".length));
      try {
        await page.locator(THREAD_ROW_SELECTOR).evaluateAll(clickInstagramConversationRow, {
          index,
          title: conversation.title,
          preview: conversation.preview,
          identity: conversation.identity,
        });
      } catch (error) {
        this.activeConversationOverride = previousOverride;
        throw error;
      }
      if (previousOverride !== id && page.url() === previousUrl) {
        await page.waitForURL(
          (url) => /\/direct\/t\//.test(url.pathname) && url.href !== previousUrl,
          { timeout: 5_000 },
        ).catch(() => undefined);
      }
      await this.refreshAfterConversationOpen(page);
      return;
    }

    try {
      await page.goto(new URL(conversation.href, "https://www.instagram.com").href, {
        waitUntil: "domcontentloaded",
      });
      await this.refreshAfterConversationOpen(page);
    } catch (error) {
      this.activeConversationOverride = previousOverride;
      throw error;
    }
  }

  private async refreshAfterConversationOpen(page: Page): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    while (this.refreshRunning) await page.waitForTimeout(25);
    await this.performRefresh();
  }

  public async sendMessage(text: string): Promise<void> {
    const page = this.requirePage();
    const message = text.trim();
    if (!message) return;

    const editor = page.locator('[contenteditable="true"][role="textbox"]').last();
    await editor.waitFor({ state: "visible", timeout: 5_000 });
    const previousLastMessageId = this.snapshot.messages.at(-1)?.id;
    await editor.fill(message);
    await editor.press("Enter");
    const confirmed = await this.confirmSentMessage(page, message, previousLastMessageId);
    if (!confirmed) this.scheduleRefresh("sent-message-fallback", 0);
  }

  private async confirmSentMessage(
    page: Page,
    sentText: string,
    previousLastMessageId?: string,
  ): Promise<boolean> {
    const threadId = page.url().match(/\/direct\/t\/([^/?#]+)/)?.[1];
    if (!threadId) return false;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (attempt > 0) await page.waitForTimeout(50);
      const visibleMessages = await this.readVisibleMessages(page, threadId);
      const lastMessage = visibleMessages.at(-1);
      if (
        lastMessage &&
        normalizeComparableText(lastMessage.text) === normalizeComparableText(sentText) &&
        lastMessage.id !== previousLastMessageId
      ) {
        const messages = mergeMessageWindows(
          this.messageHistory.get(threadId) ?? [],
          visibleMessages,
          "newer",
        ).slice(-500);
        this.messageHistory.set(threadId, messages);
        this.updateSnapshot({
          ...this.snapshot,
          state: "connected",
          activeConversationId: this.activeConversationOverride ?? threadId,
          messages,
        });
        return true;
      }
    }
    return false;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("Instagram 커넥터가 시작되지 않았습니다.");
    return this.page;
  }

  private async installWakeSignals(page: Page): Promise<void> {
    await page.exposeBinding("__ohMyDmWake", () => {
      this.scheduleRefresh("dom");
    });

    page.on("websocket", (socket) => {
      socket.on("framereceived", () => this.scheduleRefresh("websocket"));
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.scheduleRefresh("navigation", 120);
    });
    page.on("close", () => this.setDisconnected("브라우저 탭이 닫혔습니다."));

    await page.addInitScript(observeInstagramChanges);
    await page.evaluate(observeInstagramChanges).catch(() => undefined);
  }

  private scheduleRefresh(_reason: string, delay = 180): void {
    if (this.stopped) return;
    // A busy MQTT/WebSocket connection must not keep pushing the refresh
    // forever into the future. Coalesce bursts into one bounded refresh.
    if (this.refreshTimer) {
      if (delay !== 0) return;
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.performRefresh();
    }, delay);
  }

  private async performRefresh(): Promise<void> {
    if (this.stopped) return;
    if (this.refreshRunning) {
      this.refreshAgain = true;
      return;
    }

    this.refreshRunning = true;
    try {
      const page = this.requirePage();
      const url = page.url();
      const sessionCookies = await this.context?.cookies("https://www.instagram.com") ?? [];
      const hasSession = sessionCookies.some(
        (cookie) => cookie.name === "sessionid" && cookie.value.length > 0,
      );
      const loginRequired = !hasSession || /\/accounts\/login|\/challenge\//.test(url);

      if (loginRequired) {
        this.updateSnapshot({
          ...this.snapshot,
          state: "login-required",
          detail: "Playwright Chromium에서 Instagram 로그인을 완료하세요: oh-my-dm login instagram",
        });
        return;
      }

      const rawConversations = await page.locator('a[href*="/direct/t/"]').evaluateAll(
        (elements): RawConversation[] =>
          elements.map((element) => ({
            href: (element as HTMLAnchorElement).getAttribute("href") ?? "",
            text: (element as HTMLElement).innerText ?? "",
            ariaLabel: element.getAttribute("aria-label"),
          })),
      );

      const linkConversations = dedupeConversations(
        rawConversations
          .map(normalizeConversation)
          .filter((item): item is Conversation => item !== undefined),
      );
      const rawButtonConversations = await page
          .locator(THREAD_ROW_SELECTOR)
          .evaluateAll((elements): RawConversation[] => {
            const rows = elements.filter((element) => {
              const rect = element.getBoundingClientRect();
              const parts = [...new Set(
                [...element.querySelectorAll("span")]
                  .map((part) => part.textContent?.replaceAll("\u00a0", " ").trim())
                  .filter((part): part is string => Boolean(part)),
              )];
              const text = parts.length >= 2
                ? parts.join("\n")
                : (element as HTMLElement).innerText.trim();
              return (
                text.length > 0 &&
                rect.x < 500 &&
                rect.width > 300 &&
                rect.height >= 48 &&
                rect.height <= 110
              );
            });
            return rows.map((element, index) => {
              const parts = [...new Set(
                [...element.querySelectorAll("span")]
                  .map((part) => part.textContent?.replaceAll("\u00a0", " ").trim())
                  .filter((part): part is string => Boolean(part)),
              )];
              return {
                href: `button:${index}`,
                text: parts.length >= 2
                  ? parts.join("\n")
                  : (element as HTMLElement).innerText.trim(),
                ariaLabel: element.getAttribute("aria-label"),
                identity: (() => {
                  const fiberKey = Object.keys(element).find((key) =>
                    key.startsWith("__reactFiber$"),
                  );
                  let fiber = fiberKey
                    ? (element as unknown as Record<string, {
                        memoizedProps?: Record<string, unknown>;
                        return?: unknown;
                      }>)[fiberKey]
                    : undefined;
                  for (let depth = 0; fiber && depth < 12; depth += 1) {
                    const props = fiber.memoizedProps;
                    const threadKey =
                      props?.threadKeyForSelection ?? props?.threadFbidForSelection;
                    if (typeof threadKey === "string" || typeof threadKey === "number") {
                      return `thread:${threadKey}`;
                    }
                    fiber = fiber.return as typeof fiber;
                  }
                  return undefined;
                })(),
              };
            });
          });
      const buttonConversations = stabilizeButtonConversationIds(
        rawButtonConversations
          .map(normalizeConversation)
          .filter((item): item is Conversation => item !== undefined),
        this.snapshot.conversations,
      );
      // The current Instagram layout exposes complete rows as buttons while
      // anchors can be partial (notably omitting the active thread).
      const capturedConversations = buttonConversations.length > 0
        ? buttonConversations
        : linkConversations;
      const conversations = this.preserveLoadedConversations
        ? mergeLoadedConversations(this.snapshot.conversations, capturedConversations)
        : restoreTransientConversationGaps(this.snapshot.conversations, capturedConversations);

      const routeConversationId = url.match(/\/direct\/t\/([^/?#]+)/)?.[1];
      const activeConversationId = routeConversationId
        ? this.activeConversationOverride ?? routeConversationId
        : undefined;
      const visibleMessages = activeConversationId
        ? await this.readVisibleMessages(page, routeConversationId ?? activeConversationId)
        : [];
      const messageThreadId = routeConversationId ?? activeConversationId;
      const mergedMessages = messageThreadId
        ? mergeMessageWindows(
            this.messageHistory.get(messageThreadId) ?? [],
            visibleMessages,
            this.loadingOlder ? "older" : "newer",
          )
        : [];
      const messages = this.loadingOlder
        ? mergedMessages.slice(0, 500)
        : mergedMessages.slice(-500);
      if (messageThreadId) this.messageHistory.set(messageThreadId, messages);

      this.updateSnapshot({
        state: "connected",
        conversations,
        activeConversationId,
        messages,
        detail: conversations.length
          ? `${this.browserLabel} · DOM + WebSocket 이벤트 감지 중`
          : `${this.browserLabel} · 대화 목록을 기다리는 중`,
      });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (isTransientInstagramNavigationError(normalized)) {
        // Instagram replaces the document while switching routes. A DOM read
        // caught in that small window is expected; retry against the new page
        // instead of surfacing a connector failure in the TUI.
        this.scheduleRefresh("navigation-retry", 250);
        return;
      }
      this.emit("error", normalized);
      this.updateSnapshot({ ...this.snapshot, state: "error", detail: normalized.message });
    } finally {
      this.refreshRunning = false;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        this.scheduleRefresh("coalesced", 0);
      }
    }
  }

  private async readVisibleMessages(page: Page, threadId: string): Promise<ChatMessage[]> {
    let rawMessages = await page
      .locator('main [role="row"], main [role="listitem"]')
      .evaluateAll(readInstagramMessageRows);

    if (rawMessages.length === 0) {
      rawMessages = await page.locator("main div").evaluateAll((elements): RawMessage[] => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        return elements.flatMap((element): RawMessage[] => {
            const node = element as HTMLElement;
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            const text = node.innerText.trim();
            const reelLink = node.matches('a[href*="/reel/"]')
              ? node
              : node.closest<HTMLElement>('a[href*="/reel/"]') ??
                node.querySelector<HTMLElement>('a[href*="/reel/"]');
            let inlineShare = false;
            let sharedTargetUrl = "";
            const shareContainers: HTMLElement[] = [
              node,
              ...node.querySelectorAll<HTMLElement>("*"),
            ];
            let shareContainer = node.parentElement;
            for (let depth = 0; depth < 5 && shareContainer; depth += 1) {
              shareContainers.push(shareContainer);
              if (shareContainer.matches('[role="row"], [role="listitem"]')) break;
              shareContainer = shareContainer.parentElement;
            }
            for (const candidateContainer of shareContainers.slice(0, 100)) {
              const fiberKey = Object.keys(candidateContainer).find((key) =>
                key.startsWith("__reactFiber$") || key.startsWith("__reactProps$"),
              );
              if (!fiberKey) continue;
              const root = (candidateContainer as unknown as Record<string, unknown>)[fiberKey];
              const fiberQueue: Array<{ value: unknown; depth: number }> = [
                { value: root, depth: 0 },
              ];
              const visitedFibers = new WeakSet<object>();
              for (let fiberIndex = 0; fiberIndex < fiberQueue.length && fiberIndex < 60; fiberIndex += 1) {
                const fiberEntry = fiberQueue[fiberIndex]!;
                const fiberValue = fiberEntry.value;
                if (!fiberValue || typeof fiberValue !== "object" || visitedFibers.has(fiberValue)) continue;
                visitedFibers.add(fiberValue);
                const fiber = fiberValue as Record<string, unknown>;
                const propsQueue: Array<{ value: unknown; depth: number }> = [
                  { value: fiber.memoizedProps, depth: 0 },
                  { value: fiber.pendingProps, depth: 0 },
                ];
                const visitedProps = new WeakSet<object>();
                for (let propIndex = 0; propIndex < propsQueue.length && propIndex < 120; propIndex += 1) {
                  const entry = propsQueue[propIndex]!;
                  if (!entry.value || typeof entry.value !== "object" || visitedProps.has(entry.value)) continue;
                  try {
                    if (entry.value instanceof Node || entry.value instanceof Window) continue;
                  } catch {
                    continue;
                  }
                  visitedProps.add(entry.value);
                  const record = entry.value as Record<string, unknown>;
                  try {
                    if (record.content_type === "MESSAGE_INLINE_SHARE") inlineShare = true;
                    if (typeof record.targetUrl === "string") sharedTargetUrl = record.targetUrl;
                  } catch {
                    continue;
                  }
                  if (entry.depth >= 4) continue;
                  try {
                    for (const value of Object.values(record)) {
                      if (
                        value &&
                        typeof value === "object" &&
                        !(value instanceof Node) &&
                        !(value instanceof Window)
                      ) {
                        propsQueue.push({ value, depth: entry.depth + 1 });
                      }
                    }
                  } catch {
                    continue;
                  }
                }
                if (fiberEntry.depth < 5 && fiber.child) {
                  fiberQueue.push({ value: fiber.child, depth: fiberEntry.depth + 1 });
                }
                if (fiberEntry.depth > 0 && fiber.sibling) {
                  fiberQueue.push({ value: fiber.sibling, depth: fiberEntry.depth });
                }
                if (inlineShare && sharedTargetUrl) break;
              }
              if (inlineShare && sharedTargetUrl) break;
            }
            const isReel = Boolean(
              reelLink ||
              (inlineShare && (
                /instagram\.com\/reel\//i.test(sharedTargetUrl) ||
                /instagram\.com\/p\//i.test(sharedTargetUrl) &&
                  /(?:carousel_share_child_media_id|is_ineligible_for_clips_chaining=false)/i.test(sharedTargetUrl)
              )),
            );
            const reelTitle = reelLink
              ? [
                  reelLink.getAttribute("aria-label"),
                  reelLink.getAttribute("title"),
                ]
                  .map((candidate) => candidate?.replaceAll("\u00a0", " ").trim())
                  .find((candidate): candidate is string => Boolean(
                    candidate &&
                    candidate.length <= 240 &&
                    !/^[a-z0-9._]+$/i.test(candidate) &&
                    !/^(?:릴스|reel|reels|watch reel|original audio)$/i.test(candidate) &&
                    !/(?:님의 릴스|(?:'s|’s) reel|reel by .+)$/i.test(candidate),
                  ))
              : undefined;
            const isVisibleChatArea =
              rect.x > Math.min(470, viewportWidth * 0.38) &&
              rect.y > 70 &&
              rect.bottom < viewportHeight - 45;
            const isBubbleShape =
              rect.width >= 20 &&
              rect.width < viewportWidth * 0.55 &&
              rect.height >= 24 &&
              rect.height < 220 &&
              style.borderRadius.includes("px");
            const hasBubbleColor =
              style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
              style.backgroundColor !== "rgb(255, 255, 255)" &&
              style.backgroundColor !== "rgb(0, 0, 0)";
            if (!text || !isVisibleChatArea || !isBubbleShape || !hasBubbleColor) return [];

            const sentByMe = rect.right > viewportWidth * 0.9;
            let sender = sentByMe ? "나" : "unknown";
            let senderSource: "display" | "profile" | undefined;
            if (!sentByMe) {
              let container = node.parentElement;
              const containers: HTMLElement[] = [];
              for (let depth = 0; depth < 9 && container; depth += 1) {
                containers.push(container);
                container = container.parentElement;
              }
              for (const candidateContainer of containers) {
                const containerRect = candidateContainer.getBoundingClientRect();
                const lines = [
                  ...new Set(
                    candidateContainer.innerText
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  ),
                ];
                const candidate = lines[0];
                if (
                  containerRect.height < 300 &&
                  lines.length >= 2 &&
                  candidate &&
                  candidate !== text &&
                  candidate.length <= 80
                ) {
                  sender = candidate;
                  senderSource = "display";
                  break;
                }
              }
              if (sender === "unknown") {
                for (const candidateContainer of containers) {
                  const labels = [
                    ...candidateContainer.querySelectorAll<HTMLElement>('img[alt], [aria-label], [title]'),
                  ].flatMap((candidateNode) => [
                    candidateNode.getAttribute("alt"),
                    candidateNode.getAttribute("aria-label"),
                    candidateNode.getAttribute("title"),
                  ]);
                  const profileLabel = labels.find((label): label is string =>
                    Boolean(
                      label &&
                      label.length <= 120 &&
                      /프로필 사진|profile picture|보낸 메시지|프로필 페이지|open the profile page of/i.test(label),
                    ),
                  );
                  if (profileLabel) {
                    sender = profileLabel;
                    senderSource = "profile";
                    break;
                  }
                }
              }
            }
            return [{
              text: isReel
                ? reelTitle
                  ? `${reelTitle.replace(/\s*\(릴스\)$/, "")}(릴스)`
                  : "(릴스)"
                : text,
              sender,
              timestamp: null,
              ...(isReel ? { kind: "reel" as const } : {}),
              ...(senderSource ? { senderSource } : {}),
            }];
          });
      });
    }

    let lastExternalSender: string | undefined;
    rawMessages = rawMessages.map((raw) => {
      if (raw.sender === "나") {
        lastExternalSender = undefined;
        return raw;
      }
      if (raw.kind === "reel" && raw.senderSource === "profile" && lastExternalSender) {
        return { ...raw, sender: lastExternalSender };
      }
      if (raw.sender && raw.sender !== "unknown") {
        lastExternalSender = raw.sender;
        return raw;
      }
      return lastExternalSender ? { ...raw, sender: lastExternalSender } : raw;
    });

    return rawMessages
      .map((raw, index) => normalizeMessage(threadId, raw, index))
      .filter((item): item is ChatMessage => item !== undefined)
      .slice(-100);
  }

  private updateSnapshot(snapshot: ChatSnapshot): void {
    this.snapshot = snapshot;
    const fingerprint = JSON.stringify(snapshot);
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    this.emit("snapshot", snapshot);
  }

  private setDisconnected(detail: string): void {
    this.updateSnapshot({ ...this.snapshot, state: "disconnected", detail });
  }
}

export function isTransientInstagramNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "execution context was destroyed",
    "most likely because of a navigation",
    "cannot find context with specified id",
    "frame was detached",
  ].some((fragment) => message.toLowerCase().includes(fragment));
}


function normalizeComparableText(value: string): string {
  return value.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
}

export function observeInstagramChanges(): void {
  const key = "__ohMyDmObserverInstalled";
  const browserWindow = window as typeof window & Record<string, unknown>;
  if (browserWindow[key]) return;
  browserWindow[key] = true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (!document.body) return;
      new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const callback = browserWindow.__ohMyDmWake;
          if (typeof callback === "function") void callback();
        }, 120);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-label", "aria-live", "href"],
      });
    }, { once: true });
  } else if (document.body) {
    new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const callback = browserWindow.__ohMyDmWake;
        if (typeof callback === "function") void callback();
      }, 120);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-live", "href"],
    });
  }
}

function dedupeConversations(items: Conversation[]): Conversation[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
