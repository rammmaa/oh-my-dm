import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright-core";

import { cloneBrowserProfile, isProfileLockError } from "../browser/profile.js";
import { resolveBrowserExecutable } from "../browser/resolve-browser.js";
import { observeDomChanges } from "../browser/wake-signals.js";
import type {
  ChatConnector,
  ChatMessage,
  ChatSnapshot,
  Conversation,
} from "../domain.js";
import {
  compareSnowflakes,
  mergeDiscordConversations,
  mergeDiscordMessages,
  normalizeDiscordChannelRow,
  normalizeDiscordDmRow,
  normalizeDiscordForumPost,
  normalizeDiscordMessages,
  parseDiscordRoute,
  parseDiscordTitleName,
  readDiscordChannelRows,
  readDiscordCurrentUser,
  readDiscordDmRows,
  readDiscordGuildRows,
  readDiscordMessageRows,
  readDiscordForumPosts,
  readDiscordOpenChannelName,
  readDiscordSidebarGuildName,
  updateDiscordConversations,
  type RawDiscordGuildRow,
} from "./discord-dom.js";
import type { DiscordChannelPin } from "../config.js";

const DISCORD_ORIGIN = "https://discord.com";
const HOME_URL = `${DISCORD_ORIGIN}/channels/@me`;
const DM_LIST_SELECTOR = '[data-list-id^="private-channels"]';
const DM_ROW_SELECTOR = `${DM_LIST_SELECTOR} a[href^="/channels/@me/"]`;
const GUILD_ROW_SELECTOR = '[data-list-item-id^="guildsnav___"]';
const GUILD_HOME_SELECTOR = '[data-list-item-id="guildsnav___home"]';
const CHANNEL_ROW_SELECTOR = 'a[data-list-item-id^="channels___"]';
const MESSAGE_LIST_SELECTOR = 'ol[data-list-id="chat-messages"]';
const MESSAGE_ROW_SELECTOR = `${MESSAGE_LIST_SELECTOR} li[id^="chat-messages-"]`;
const COMPOSER_SELECTOR = '[role="textbox"][data-slate-editor="true"]';
const CURRENT_USER_SELECTOR = '[class*="nameTag"]';
const FORUM_POST_SELECTOR = '[data-item-id][class*="mainCard"]';
const MAX_HISTORY = 500;

export interface DiscordWebOptions {
  profileDir: string;
  headless?: boolean;
  cloneProfileWhenLocked?: boolean;
  // Channels or threads to add to the list even when the scan cannot find
  // them, such as posts inside a forum channel. See parseDiscordChannelPins.
  pinnedChannels?: DiscordChannelPin[];
}

export function isTransientDiscordNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Target (?:page, context or browser|closed)|has been closed|frame was detached|Cannot find context|Navigation/i.test(message);
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export class DiscordWebConnector extends EventEmitter implements ChatConnector {
  private context?: BrowserContext;
  private page?: Page;
  private refreshTimer?: NodeJS.Timeout;
  private refreshRunning = false;
  private refreshAgain = false;
  private browserLabel = "Chromium";
  private stopped = false;
  private desiredRunning = false;
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private pageLock: Promise<void> = Promise.resolve();
  private temporaryProfileDir?: string;
  private currentUserId?: string;
  private activeConversationId?: string;
  private dmConversations: Conversation[] = [];
  private dmListScrolled = false;
  private guildOrder: string[] = [];
  private readonly guildNames = new Map<string, string>();
  private readonly guildConversations = new Map<string, Conversation[]>();
  private readonly pinnedChannels: DiscordChannelPin[];
  private readonly pinnedNames = new Map<string, string>();
  // Forum channels expand into their posts, keyed by the forum channel id.
  private readonly forumPosts = new Map<string, Conversation[]>();
  private guildScanState: "idle" | "running" | "done" = "idle";
  private guildScanDetail?: string;
  private loadingOlder = false;
  private readonly messageHistory = new Map<string, ChatMessage[]>();
  private snapshot: ChatSnapshot = {
    state: "starting",
    conversations: [],
    messages: [],
    detail: "브라우저 엔진을 시작하는 중",
  };

  public constructor(private readonly options: DiscordWebOptions) {
    super();
    this.pinnedChannels = options.pinnedChannels ?? [];
  }

  public getSnapshot(): ChatSnapshot {
    return this.snapshot;
  }

  public async refresh(): Promise<void> {
    await this.requireReadyPage();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    await this.performRefresh();
  }

  public start(): Promise<void> {
    this.desiredRunning = true;
    this.stopped = false;
    return this.enqueueLifecycle(async () => {
      if (!this.desiredRunning) return;
      if (this.getUsablePage()) return;
      if (this.context) {
        await this.context.close().catch(() => undefined);
        this.context = undefined;
        this.page = undefined;
        await this.removeTemporaryProfile();
      }
      await this.startBrowser();
    });
  }

  private async startBrowser(): Promise<void> {
    await fs.mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    const headless = this.options.headless ?? true;
    const browser = resolveBrowserExecutable();
    this.browserLabel = `${browser.label}${headless ? " Headless" : ""}`;
    // Discord keeps its session in localStorage, which Chromium only flushes
    // to disk on a clean shutdown. Leave SIGINT to the CLI so `login discord`
    // can close the context gracefully instead of letting Playwright kill it.
    const launch = (profileDir: string) => chromium.launchPersistentContext(profileDir, {
      executablePath: browser.executablePath,
      headless,
      handleSIGINT: false,
      // Discord virtualizes its channel and message lists, so a tall headless
      // viewport keeps more rows in the DOM. Headed windows stay screen-sized.
      viewport: headless ? { width: 1100, height: 2400 } : { width: 1100, height: 780 },
    });
    let runtimeProfileDir = this.options.profileDir;
    try {
      if (
        this.options.cloneProfileWhenLocked &&
        await fs.lstat(path.join(this.options.profileDir, "SingletonLock"))
          .then(() => true)
          .catch(() => false)
      ) {
        const clone = await cloneBrowserProfile(this.options.profileDir, undefined, "oh-my-dm-discord-");
        runtimeProfileDir = clone.profileDir;
        this.temporaryProfileDir = clone.cleanupDir;
        this.browserLabel = `${this.browserLabel} · shared session`;
      }
      try {
        this.context = await launch(runtimeProfileDir);
      } catch (error) {
        if (
          !this.options.cloneProfileWhenLocked ||
          runtimeProfileDir !== this.options.profileDir ||
          !isProfileLockError(error)
        ) throw error;
        const clone = await cloneBrowserProfile(this.options.profileDir, undefined, "oh-my-dm-discord-");
        runtimeProfileDir = clone.profileDir;
        this.temporaryProfileDir = clone.cleanupDir;
        this.browserLabel = `${this.browserLabel} · shared session`;
        this.context = await launch(runtimeProfileDir);
      }
    } catch (error) {
      await this.removeTemporaryProfile();
      const detail = error instanceof Error ? error.message : String(error);
      this.updateSnapshot({ ...this.snapshot, state: "error", detail });
      throw error;
    }
    if (this.stopped) {
      await this.context.close();
      this.context = undefined;
      await this.removeTemporaryProfile();
      return;
    }

    try {
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
      await this.installWakeSignals(this.page);
      await this.page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
      this.scheduleRefresh("startup", 0);
    } catch (error) {
      await this.context.close().catch(() => undefined);
      this.context = undefined;
      this.page = undefined;
      await this.removeTemporaryProfile();
      const detail = error instanceof Error ? error.message : String(error);
      this.updateSnapshot({ ...this.snapshot, state: "error", detail });
      throw error;
    }
  }

  public stop(): Promise<void> {
    this.desiredRunning = false;
    this.stopped = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    return this.enqueueLifecycle(async () => {
      // React can immediately mount the same connector again after an effect
      // cleanup. In that case the newest intent wins.
      if (this.desiredRunning) return;
      await this.context?.close();
      this.context = undefined;
      this.page = undefined;
      await this.removeTemporaryProfile();
    });
  }

  private enqueueLifecycle(task: () => Promise<void>): Promise<void> {
    const pending = this.lifecycleQueue.then(task, task);
    this.lifecycleQueue = pending.catch(() => undefined);
    return pending;
  }

  // Navigation and user actions share one page. Serialize them so an open
  // never navigates away in the middle of a send or a history load.
  private withPageLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.pageLock.then(task, task);
    this.pageLock = run.then(() => undefined, () => undefined);
    return run;
  }

  private async removeTemporaryProfile(): Promise<void> {
    const temporaryProfileDir = this.temporaryProfileDir;
    this.temporaryProfileDir = undefined;
    if (temporaryProfileDir) {
      await fs.rm(temporaryProfileDir, { recursive: true, force: true });
    }
  }

  public async openConversation(id: string): Promise<void> {
    const page = await this.requireReadyPage();
    const conversation = this.snapshot.conversations.find((item) => item.id === id);
    if (!conversation) throw new Error(`대화를 찾을 수 없습니다: ${id}`);
    const previous = this.activeConversationId;
    // Pin the target before navigating so a refresh triggered by the route
    // change never publishes the previous conversation as active.
    this.activeConversationId = id;
    this.loadingOlder = false;
    try {
      await this.withPageLock(async () => {
        if (parseDiscordRoute(page.url()).channelId !== id) {
          await this.navigateToConversation(page, conversation);
        }
        await page
          .locator(`${MESSAGE_LIST_SELECTOR} li[id^="chat-messages-${id}-"]`)
          .first()
          .waitFor({ state: "attached", timeout: 6_000 })
          .catch(() => undefined);
      });
      this.dmListScrolled = false;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
      while (this.refreshRunning) await page.waitForTimeout(25);
      await this.performRefresh();
      await this.resolvePinnedName(page, id);
    } catch (error) {
      this.activeConversationId = previous;
      throw error;
    }
  }

  public async sendMessage(text: string): Promise<void> {
    const page = await this.requireReadyPage();
    const message = text.trim();
    if (!message) return;
    const channelId = this.activeConversationId;
    if (!channelId) throw new Error("먼저 대화를 선택하세요.");
    this.loadingOlder = false;
    const previousLastId = this.messageHistory.get(channelId)?.at(-1)?.id;
    const confirmed = await this.withPageLock(async () => {
      if (parseDiscordRoute(page.url()).channelId !== channelId) {
        const conversation = this.snapshot.conversations.find((item) => item.id === channelId);
        if (!conversation) throw new Error(`대화를 찾을 수 없습니다: ${channelId}`);
        await this.navigateToConversation(page, conversation);
      }
      // The composer is a Slate editor, which ignores locator.fill(). Type
      // through the keyboard instead so Discord sees real input events.
      const composer = page.locator(COMPOSER_SELECTOR).last();
      await composer.waitFor({ state: "visible", timeout: 5_000 });
      await composer.click();
      await page.keyboard.insertText(message);
      await page.keyboard.press("Enter");
      return this.confirmSentMessage(page, channelId, message, previousLastId);
    });
    if (!confirmed) this.scheduleRefresh("sent-message-fallback", 0);
  }

  private async confirmSentMessage(
    page: Page,
    channelId: string,
    sentText: string,
    previousLastId?: string,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (attempt > 0) await page.waitForTimeout(100);
      const visible = await this.readVisibleMessages(page, channelId).catch(() => [] as ChatMessage[]);
      const last = visible.at(-1);
      if (
        last &&
        last.id !== previousLastId &&
        last.sender === "나" &&
        normalizeComparableText(last.text) === normalizeComparableText(sentText)
      ) {
        const merged = mergeDiscordMessages(this.messageHistory.get(channelId) ?? [], visible)
          .slice(-MAX_HISTORY);
        this.messageHistory.set(channelId, merged);
        this.publishConnected();
        return true;
      }
    }
    return false;
  }

  public async loadOlderMessages(): Promise<number> {
    const page = await this.requireReadyPage();
    const channelId = this.activeConversationId;
    if (!channelId) return 0;
    return this.withPageLock(async () => {
      if (parseDiscordRoute(page.url()).channelId !== channelId) return 0;
      while (this.refreshRunning) await page.waitForTimeout(50);
      this.loadingOlder = true;
      try {
        const existing = this.messageHistory.get(channelId) ?? [];
        const oldestId = existing[0]?.id;
        // Message ids are stable, so the merge does not need overlapping
        // windows. Jump to the top and let Discord prepend older history.
        const moved = await page.locator(MESSAGE_LIST_SELECTOR).first().evaluate((list): boolean => {
          let element: HTMLElement | null = list as HTMLElement;
          for (let depth = 0; depth < 6 && element; depth += 1) {
            const style = getComputedStyle(element);
            if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) break;
            element = element.parentElement;
          }
          if (!element) return false;
          if (element.scrollTop === 0) return false;
          element.scrollTop = 0;
          return true;
        }).catch(() => false);
        if (!moved) return 0;
        let incoming: ChatMessage[] = [];
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await page.waitForTimeout(250);
          incoming = await this.readVisibleMessages(page, channelId);
          const oldest = incoming[0]?.id;
          if (oldest && (!oldestId || compareSnowflakes(oldest, oldestId) < 0)) break;
        }
        const merged = mergeDiscordMessages(existing, incoming).slice(0, MAX_HISTORY);
        this.messageHistory.set(channelId, merged);
        this.publishConnected();
        return Math.max(0, merged.length - existing.length);
      } finally {
        this.loadingOlder = false;
      }
    });
  }

  public async loadMoreConversations(): Promise<number> {
    const page = await this.requireReadyPage();
    return this.withPageLock(async () => {
      // The DM list is only rendered under /channels/@me.
      if (parseDiscordRoute(page.url()).guildId) return 0;
      while (this.refreshRunning) await page.waitForTimeout(50);
      const previousCount = this.dmConversations.length;
      const moved = await page.locator(DM_LIST_SELECTOR).first().evaluate((list): boolean => {
        const element = list as HTMLElement;
        const before = element.scrollTop;
        element.scrollTop = before + Math.max(200, Math.floor(element.clientHeight * 0.8));
        return element.scrollTop !== before;
      }).catch(() => false);
      if (!moved) return 0;
      this.dmListScrolled = true;
      await page.waitForTimeout(400);
      await this.performRefresh();
      return Math.max(0, this.dmConversations.length - previousCount);
    });
  }

  // In-app navigation keeps the gateway session and renders a channel within
  // a few hundred milliseconds, while a full page load reboots the app and
  // takes several seconds. Fall back to a page load when the rows needed for
  // clicking are not in the DOM (collapsed categories, virtualized DM rows).
  private async navigateToConversation(page: Page, conversation: Conversation): Promise<void> {
    const target = parseDiscordRoute(conversation.href);
    const clicked = target.channelId
      ? await this.clickConversationRow(page, conversation.href, target.guildId, target.channelId)
      : false;
    if (!clicked) {
      await page.goto(`${DISCORD_ORIGIN}${conversation.href}`, { waitUntil: "domcontentloaded" });
    }
  }

  private async clickConversationRow(
    page: Page,
    href: string,
    guildId: string | undefined,
    channelId: string,
  ): Promise<boolean> {
    try {
      const current = parseDiscordRoute(page.url());
      if (current.login) return false;
      if (current.guildId !== guildId) {
        const guildSelector = guildId
          ? `[data-list-item-id="guildsnav___${guildId}"]`
          : GUILD_HOME_SELECTOR;
        await page.locator(guildSelector).first().click({ timeout: 1_000 });
      }
      const row = page
        .locator(guildId ? `a[data-list-item-id="channels___${channelId}"]` : `${DM_LIST_SELECTOR} a[href="${href}"]`)
        .first();
      await row.waitFor({ state: "attached", timeout: 1_500 });
      await row.click({ timeout: 1_000 });
      await page.waitForURL((url) => parseDiscordRoute(url.href).channelId === channelId, { timeout: 2_000 });
      return true;
    } catch {
      return false;
    }
  }

  // Show a server's channel list, preferring an in-app click over a reload.
  private async showGuild(page: Page, guildId: string): Promise<void> {
    const clicked = await page
      .locator(`[data-list-item-id="guildsnav___${guildId}"]`)
      .first()
      .click({ timeout: 1_000 })
      .then(() => true, () => false);
    const routed = clicked && await page
      .waitForURL((url) => parseDiscordRoute(url.href).guildId === guildId, { timeout: 2_000 })
      .then(() => true, () => false);
    if (!routed) {
      await page.goto(`${DISCORD_ORIGIN}/channels/${guildId}`, { waitUntil: "domcontentloaded" });
    }
    await page
      .locator(`a[href^="/channels/${guildId}/"]`)
      .first()
      .waitFor({ state: "attached", timeout: 4_000 });
  }

  private requirePage(): Page {
    const page = this.getUsablePage();
    if (!page) throw new Error("Discord 커넥터가 시작되지 않았습니다.");
    return page;
  }

  private async requireReadyPage(): Promise<Page> {
    const page = this.getUsablePage();
    if (page) return page;
    await this.start();
    return this.requirePage();
  }

  private getUsablePage(): Page | undefined {
    const page = this.page;
    if (!page) return undefined;
    const isClosed = (page as Page & { isClosed?: () => boolean }).isClosed;
    return typeof isClosed !== "function" || !isClosed.call(page) ? page : undefined;
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
    await page.addInitScript(observeDomChanges);
    await page.evaluate(observeDomChanges).catch(() => undefined);
  }

  private scheduleRefresh(_reason: string, delay = 180): void {
    if (this.stopped) return;
    if (this.loadingOlder) return;
    // Discord's gateway socket is chatty. Coalesce bursts into one refresh.
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
      const route = parseDiscordRoute(page.url());
      if (route.login) {
        this.updateSnapshot({
          ...this.snapshot,
          state: "login-required",
          conversations: [],
          messages: [],
          detail: "Playwright Chromium에서 Discord 로그인을 완료하세요: oh-my-dm login discord",
        });
        return;
      }
      if (!this.currentUserId) await this.readCurrentUser(page);

      if (!route.guildId) {
        const rows = await page.locator(DM_ROW_SELECTOR).evaluateAll(readDiscordDmRows).catch(() => []);
        const incoming = rows
          .map(normalizeDiscordDmRow)
          .filter((item): item is Conversation => item !== undefined);
        if (incoming.length > 0) {
          // Discord orders DMs by recency. Follow that order unless the list
          // was scrolled to load more rows, in which case the virtualized top
          // rows are missing and the captured order must be preserved.
          this.dmConversations = this.dmListScrolled
            ? updateDiscordConversations(this.dmConversations, incoming)
            : mergeDiscordConversations(incoming, this.dmConversations);
        }
      } else {
        // The main page has a normal viewport, so the virtualized channel
        // list only shows a window. Refresh what is visible, keep the rest.
        await this.readGuildChannels(page, route.guildId, "update");
      }

      if (this.guildScanState === "idle") {
        this.guildScanState = "running";
        void this.scanGuilds();
      }

      // Only the pinned conversation is ever treated as active. Discord
      // auto-opens a channel whenever a server is visited, and that must not
      // leak into the transcript.
      const activeId = this.activeConversationId;
      if (activeId && route.channelId === activeId) {
        const incoming = await this.readVisibleMessages(page, activeId);
        if (incoming.length > 0) {
          const merged = mergeDiscordMessages(this.messageHistory.get(activeId) ?? [], incoming);
          this.messageHistory.set(
            activeId,
            this.loadingOlder ? merged.slice(0, MAX_HISTORY) : merged.slice(-MAX_HISTORY),
          );
        }
      }
      this.publishConnected();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (isTransientDiscordNavigationError(normalized)) {
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

  private publishConnected(): void {
    if (this.stopped) return;
    const scanned = [
      ...this.dmConversations,
      ...this.guildOrder.flatMap((guildId) => this.guildConversations.get(guildId) ?? []),
    ];
    const known = new Set(scanned.map((item) => item.id));
    const pinned = this.buildPinnedConversations().filter((item) => !known.has(item.id));
    const conversations = [...scanned, ...pinned];
    const activeId = this.activeConversationId;
    const scanNote = this.guildScanState !== "done"
      ? " · 서버 채널을 읽는 중"
      : this.guildScanDetail
        ? ` · ${this.guildScanDetail}`
        : "";
    this.updateSnapshot({
      state: "connected",
      conversations,
      activeConversationId: activeId,
      messages: activeId ? this.messageHistory.get(activeId) ?? [] : [],
      detail: conversations.length
        ? `${this.browserLabel} · DOM + WebSocket 이벤트 감지 중${scanNote}`
        : `${this.browserLabel} · 대화 목록을 기다리는 중${scanNote}`,
    });
  }

  private buildPinnedConversations(): Conversation[] {
    return this.pinnedChannels.flatMap((pin) => {
      const posts = this.forumPosts.get(pin.channelId);
      if (posts && posts.length > 0) return posts;
      const guild = (this.guildNames.get(pin.guildId) ?? "").trim();
      const name = pin.label?.trim() || this.pinnedNames.get(pin.channelId) || `채널 ${pin.channelId}`;
      return [{
        id: pin.channelId,
        identity: `guild:${pin.guildId}`,
        title: guild ? `${guild} #${name}` : `#${name}`,
        href: `/channels/${pin.guildId}/${pin.channelId}`,
        unread: false,
      }];
    });
  }

  // Visit each pinned channel once. A forum shows post cards and no message
  // list, so expand it into its posts; anything else is a single conversation
  // whose name is read from the page.
  private async scanPinnedChannels(page: Page): Promise<void> {
    for (const pin of this.pinnedChannels) {
      if (this.stopped) return;
      try {
        await page.goto(`${DISCORD_ORIGIN}/channels/${pin.guildId}/${pin.channelId}`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .locator(`${FORUM_POST_SELECTOR}, ${MESSAGE_LIST_SELECTOR}`)
          .first()
          .waitFor({ state: "attached", timeout: 6_000 })
          .catch(() => undefined);
        await page.waitForTimeout(300);
        const rawPosts = await page.locator(FORUM_POST_SELECTOR).evaluateAll(readDiscordForumPosts);
        if (rawPosts.length > 0) {
          const guildName = this.guildNames.get(pin.guildId) ?? "";
          const forumName = pin.label?.trim() || parseDiscordTitleName(await page.title()) || "";
          const posts = rawPosts
            .map((raw) => normalizeDiscordForumPost(raw, pin.guildId, guildName, forumName))
            .filter((item): item is Conversation => item !== undefined);
          this.forumPosts.set(pin.channelId, posts);
        } else if (!pin.label && !this.pinnedNames.has(pin.channelId)) {
          const name = parseDiscordTitleName(await page.title());
          if (name) this.pinnedNames.set(pin.channelId, name);
        }
      } catch {
        // Leave the pin as a plain entry if it cannot be read.
      }
      this.publishConnected();
    }
  }

  // A pinned forum post never appears in the sidebar, so its name can only be
  // read while it is open. Do it once, unless the user gave an explicit label.
  private async resolvePinnedName(page: Page, channelId: string): Promise<void> {
    const pin = this.pinnedChannels.find((item) => item.channelId === channelId);
    if (!pin || pin.label || this.pinnedNames.has(channelId)) return;
    const name = await page
      .evaluate(readDiscordOpenChannelName)
      .catch(() => null);
    if (name) this.pinnedNames.set(channelId, name);
  }

  private async readCurrentUser(page: Page): Promise<void> {
    const user = await page
      .locator(CURRENT_USER_SELECTOR)
      .first()
      .evaluate(readDiscordCurrentUser, undefined, { timeout: 1_000 })
      .catch(() => undefined);
    if (user?.id) this.currentUserId = user.id;
  }

  private async readVisibleMessages(page: Page, channelId: string): Promise<ChatMessage[]> {
    const rows = await page
      .locator(MESSAGE_ROW_SELECTOR)
      .evaluateAll(readDiscordMessageRows, this.currentUserId ?? null);
    // Drop optimistic rows still being sent; they reappear with their real id
    // and would otherwise show the just-sent message twice.
    return normalizeDiscordMessages(
      rows.filter((row) => row.channelId === channelId && !row.pending),
    );
  }

  private async readGuildChannels(
    page: Page,
    guildId: string,
    mode: "replace" | "update",
  ): Promise<number> {
    const rows = await page.locator(CHANNEL_ROW_SELECTOR).evaluateAll(readDiscordChannelRows);
    const sidebarName = await page
      .locator(CHANNEL_ROW_SELECTOR)
      .first()
      .evaluate(readDiscordSidebarGuildName, undefined, { timeout: 500 })
      .catch(() => null);
    if (sidebarName) this.guildNames.set(guildId, sidebarName);
    const guildName = this.guildNames.get(guildId) ?? "";
    const conversations = rows
      .filter((row) => row.href.startsWith(`/channels/${guildId}/`))
      .map((row) => normalizeDiscordChannelRow(row, guildName))
      .filter((item): item is Conversation => item !== undefined);
    if (mode === "update") {
      this.guildConversations.set(
        guildId,
        updateDiscordConversations(this.guildConversations.get(guildId) ?? [], conversations),
      );
    } else if (conversations.length > 0 || !this.guildConversations.has(guildId)) {
      this.guildConversations.set(guildId, conversations);
    }
    return conversations.length;
  }

  // Collapsed server folders hide their guilds from the DOM. Expand them
  // one at a time until every row is a plain guild.
  private async readGuildList(page: Page): Promise<RawDiscordGuildRow[]> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rows = await page.locator(GUILD_ROW_SELECTOR).evaluateAll(readDiscordGuildRows);
      const collapsed = rows.find((row) => row.folder && row.expanded === false);
      if (!collapsed) return rows.filter((row) => !row.folder);
      await page
        .locator(`[data-list-item-id="guildsnav___${collapsed.id}"]`)
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      await page.waitForTimeout(300);
    }
    const rows = await page.locator(GUILD_ROW_SELECTOR).evaluateAll(readDiscordGuildRows);
    return rows.filter((row) => !row.folder);
  }

  // Discord only renders the channel list of the selected server, so the
  // flat conversation list is built by visiting each server once at startup.
  // The scan runs in its own tab so the main page can stay on the active
  // conversation and keep receiving live updates while servers are read.
  private async scanGuilds(): Promise<void> {
    const failed: string[] = [];
    let scanPage: Page | undefined;
    try {
      const context = this.context;
      if (!context || this.stopped) return;
      scanPage = await context.newPage();
      // The channel sidebar is virtualized, so a tall viewport is the
      // cheapest way to get every channel of a large server rendered at once.
      await scanPage.setViewportSize({ width: 1100, height: 4000 });
      await scanPage.goto(HOME_URL, { waitUntil: "domcontentloaded" });
      // The server list renders its home and add buttons before the guild
      // data arrives. Wait for the user panel, which appears once the app
      // has booted, then give the guild rows a moment to show up.
      await scanPage
        .locator(CURRENT_USER_SELECTOR)
        .first()
        .waitFor({ state: "attached", timeout: 15_000 });
      let guilds: RawDiscordGuildRow[] = [];
      for (let attempt = 0; attempt < 10 && guilds.length === 0; attempt += 1) {
        if (attempt > 0) await scanPage.waitForTimeout(300);
        guilds = await this.readGuildList(scanPage);
      }
      this.guildOrder = guilds.map((guild) => guild.id);
      for (const guild of guilds) {
        if (guild.name) this.guildNames.set(guild.id, guild.name);
      }
      for (const guild of guilds) {
        if (this.stopped) return;
        try {
          await this.showGuild(scanPage, guild.id);
          await scanPage.waitForTimeout(150);
          await this.readGuildChannels(scanPage, guild.id, "replace");
        } catch {
          failed.push(guild.name || guild.id);
        }
        this.publishConnected();
      }
      if (this.pinnedChannels.length > 0 && !this.stopped) {
        await this.scanPinnedChannels(scanPage);
      }
      this.guildScanDetail = failed.length ? `${failed.length}개 서버를 읽지 못함` : undefined;
    } catch (error) {
      this.guildScanDetail = error instanceof Error ? error.message : String(error);
    } finally {
      await scanPage?.close().catch(() => undefined);
      this.guildScanState = "done";
      this.scheduleRefresh("guild-scan-done", 0);
    }
  }

  private updateSnapshot(snapshot: ChatSnapshot): void {
    this.snapshot = snapshot;
    this.emit("snapshot", snapshot);
  }

  private setDisconnected(detail: string): void {
    this.updateSnapshot({ ...this.snapshot, state: "disconnected", detail });
  }
}
