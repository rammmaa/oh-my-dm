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
  mergeMessageWindows,
  normalizeMessage,
  restoreTransientConversationGaps,
  stabilizeButtonConversationIds,
  type RawConversation,
  type RawMessage,
} from "./instagram-dom.js";

const INBOX_URL = "https://www.instagram.com/direct/inbox/";

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
    this.loadingOlder = true;
    try {
      await this.performRefresh();
    } finally {
      this.loadingOlder = false;
    }
    return Math.max(0, (this.messageHistory.get(threadId)?.length ?? 0) - previousCount);
  }

  public async start(): Promise<void> {
    this.stopped = false;
    await fs.mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    const headless = this.options.headless ?? true;
    const browser = headless ? undefined : resolveBrowserExecutable();
    this.browserLabel = headless ? "Chromium Headless Shell" : browser!.label;
    this.context = await chromium.launchPersistentContext(this.options.profileDir, {
      ...(browser ? { executablePath: browser.executablePath } : {}),
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

    if (conversation.href.startsWith("button:")) {
      const index = Number(conversation.href.slice("button:".length));
      await page.locator('[aria-label="Thread list"] [role="button"]').evaluateAll((elements, target) => {
        let threadRowsStarted = false;
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
          const startsThreadRows =
            text.includes("·") ||
            (rect.x < 500 && rect.width > 300 && rect.height >= 48 && rect.height <= 110);
          if (startsThreadRows) threadRowsStarted = true;
          return threadRowsStarted && text.length > 0;
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
        const matched = titleMatches.find((element) => {
          if (!previewLead) return true;
          const text = (element.textContent ?? "").replaceAll("\u00a0", " ");
          return text.includes(previewLead);
        }) ?? (titleMatches.length === 1 ? titleMatches[0] : rows[target.index]);
        if (!(matched instanceof HTMLElement)) throw new Error("대화 행을 찾지 못했습니다.");
        matched.click();
      }, { index, title: conversation.title, preview: conversation.preview });
      this.activeConversationOverride = id;
      await page.waitForURL(/\/direct\/t\//, { timeout: 5_000 }).catch(() => undefined);
      this.scheduleRefresh("open-conversation", 100);
      return;
    }

    await page.goto(new URL(conversation.href, "https://www.instagram.com").href, {
      waitUntil: "domcontentloaded",
    });
    this.activeConversationOverride = id;
    this.scheduleRefresh("open-conversation", 100);
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
      const loginRequired = /\/accounts\/login|\/challenge\//.test(url);

      if (loginRequired) {
        this.updateSnapshot({
          ...this.snapshot,
          state: "login-required",
          detail: "열린 Chrome에서 Instagram 로그인을 완료하세요.",
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
          .locator('[aria-label="Thread list"] [role="button"]')
          .evaluateAll((elements): RawConversation[] => {
            let threadRowsStarted = false;
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
              const startsThreadRows =
                text.includes("·") ||
                (rect.x < 500 && rect.width > 300 && rect.height >= 48 && rect.height <= 110);
              if (startsThreadRows) threadRowsStarted = true;
              return threadRowsStarted && text.length > 0;
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
              };
            });
          });
      const buttonConversations = stabilizeButtonConversationIds(
        rawButtonConversations
          .map(normalizeConversation)
          .filter((item): item is Conversation => item !== undefined),
      );
      // The current Instagram layout exposes complete rows as buttons while
      // anchors can be partial (notably omitting the active thread).
      const capturedConversations = buttonConversations.length > 0
        ? buttonConversations
        : linkConversations;
      const conversations = restoreTransientConversationGaps(
        this.snapshot.conversations,
        capturedConversations,
      );

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
      .evaluateAll((elements): RawMessage[] =>
        elements
          .map((element) => {
            const node = element as HTMLElement;
            const text = node.innerText ?? "";
            const ownLabel = element.getAttribute("aria-label");
            let sender: string | null = null;
            let container: HTMLElement | null = node;

            for (let depth = 0; depth < 7 && container && !sender; depth += 1) {
              const lines = [...new Set(
                container.innerText
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              )];
              if (lines.length >= 2 && lines[0] !== text.trim() && lines[0]!.length <= 80) {
                sender = lines[0]!;
                break;
              }

              const labels = [
                ...container.querySelectorAll<HTMLElement>('img[alt], [aria-label], [title]'),
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
              container = container.parentElement;
            }

            return {
              text,
              sender,
              ariaLabel: ownLabel,
              timestamp: element.querySelector("time")?.getAttribute("datetime"),
            };
          })
          .filter((item) => item.text.trim().length > 0),
      );

    if (rawMessages.length === 0) {
      rawMessages = await page.locator("main div").evaluateAll((elements): RawMessage[] => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        return elements.flatMap((element): RawMessage[] => {
            const node = element as HTMLElement;
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            const text = node.innerText.trim();
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
            if (!sentByMe) {
              let container = node.parentElement;
              for (let depth = 0; depth < 9 && container; depth += 1) {
                const containerRect = container.getBoundingClientRect();
                const lines = [
                  ...new Set(
                    container.innerText
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
                  break;
                }

                const labels = [
                  ...container.querySelectorAll<HTMLElement>('img[alt], [aria-label], [title]'),
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
                  break;
                }
                container = container.parentElement;
              }
            }
            return [{
              text,
              sender,
              timestamp: null,
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

function normalizeComparableText(value: string): string {
  return value.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
}

function observeInstagramChanges(): void {
  const key = "__ohMyDmObserverInstalled";
  const browserWindow = window as typeof window & Record<string, unknown>;
  if (browserWindow[key]) return;
  browserWindow[key] = true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const wake = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const callback = browserWindow.__ohMyDmWake;
      if (typeof callback === "function") void callback();
    }, 120);
  };

  const start = (): void => {
    if (!document.body) return;
    new MutationObserver(wake).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-live", "href"],
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

function dedupeConversations(items: Conversation[]): Conversation[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
