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
  normalizeDiscordMessages,
  parseDiscordRoute,
  readDiscordChannelRows,
  readDiscordCurrentUser,
  readDiscordDmRows,
  readDiscordGuildRows,
  readDiscordMessageRows,
  readDiscordSidebarGuildName,
  type RawDiscordGuildRow,
} from "./discord-dom.js";

const DISCORD_ORIGIN = "https://discord.com";
const HOME_URL = `${DISCORD_ORIGIN}/channels/@me`;
const DM_LIST_SELECTOR = '[data-list-id^="private-channels"]';
const DM_ROW_SELECTOR = `${DM_LIST_SELECTOR} a[href^="/channels/@me/"]`;
const GUILD_ROW_SELECTOR = '[data-list-item-id^="guildsnav___"]';
const CHANNEL_ROW_SELECTOR = 'a[data-list-item-id^="channels___"]';
const MESSAGE_LIST_SELECTOR = 'ol[data-list-id="chat-messages"]';
const MESSAGE_ROW_SELECTOR = `${MESSAGE_LIST_SELECTOR} li[id^="chat-messages-"]`;
const COMPOSER_SELECTOR = '[role="textbox"][data-slate-editor="true"]';
const CURRENT_USER_SELECTOR = '[class*="nameTag"]';
const MAX_HISTORY = 500;

export interface DiscordWebOptions {
  profileDir: string;
  headless?: boolean;
  cloneProfileWhenLocked?: boolean;
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
    const launch = (profileDir: string) => chromium.launchPersistentContext(profileDir, {
      executablePath: browser.executablePath,
      headless,
      viewport: { width: 1100, height: 780 },
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

  // Navigation and user actions share one page. Serialize them so a guild
  // scan step never navigates away in the middle of a send or open.
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
          await page.goto(`${DISCORD_ORIGIN}${conversation.href}`, { waitUntil: "domcontentloaded" });
        }
        await page
          .locator(`${MESSAGE_LIST_SELECTOR} li[id^="chat-messages-${id}-"]`)
          .first()
          .waitFor({ state: "attached", timeout: 3_000 })
          .catch(() => undefined);
      });
      this.dmListScrolled = false;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
      while (this.refreshRunning) await page.waitForTimeout(25);
      await this.performRefresh();
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
        await page.goto(`${DISCORD_ORIGIN}${conversation.href}`, { waitUntil: "domcontentloaded" });
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
            ? mergeDiscordConversations(this.dmConversations, incoming)
            : mergeDiscordConversations(incoming, this.dmConversations);
        }
      } else if (this.guildScanState === "done") {
        await this.readGuildChannels(page, route.guildId);
      }

      if (this.currentUserId && this.guildScanState === "idle") {
        this.guildScanState = "running";
        void this.scanGuilds();
      }

      // Only the pinned conversation is ever treated as active. The guild
      // scan navigates through channels Discord auto-opens, and those must
      // not leak into the transcript.
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
    const conversations = [
      ...this.dmConversations,
      ...this.guildOrder.flatMap((guildId) => this.guildConversations.get(guildId) ?? []),
    ];
    const activeId = this.activeConversationId;
    const scanNote = this.guildScanState === "running"
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
    return normalizeDiscordMessages(rows.filter((row) => row.channelId === channelId));
  }

  private async readGuildChannels(page: Page, guildId: string): Promise<number> {
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
    if (conversations.length > 0 || !this.guildConversations.has(guildId)) {
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
  private async scanGuilds(): Promise<void> {
    const failed: string[] = [];
    try {
      const guilds = await this.withPageLock(async () => this.readGuildList(this.requirePage()));
      this.guildOrder = guilds.map((guild) => guild.id);
      for (const guild of guilds) {
        if (guild.name) this.guildNames.set(guild.id, guild.name);
      }
      for (const guild of guilds) {
        if (this.stopped) return;
        await this.withPageLock(async () => {
          const page = this.requirePage();
          try {
            await page.goto(`${DISCORD_ORIGIN}/channels/${guild.id}`, { waitUntil: "domcontentloaded" });
            await page
              .locator(`a[href^="/channels/${guild.id}/"]`)
              .first()
              .waitFor({ state: "attached", timeout: 4_000 });
            await page.waitForTimeout(150);
            await this.readGuildChannels(page, guild.id);
          } catch {
            failed.push(guild.name || guild.id);
          }
        });
        this.publishConnected();
      }
      this.guildScanDetail = failed.length ? `${failed.length}개 서버를 읽지 못함` : undefined;
      await this.withPageLock(async () => {
        if (this.stopped) return;
        const page = this.requirePage();
        const active = this.activeConversationId
          ? this.snapshot.conversations.find((item) => item.id === this.activeConversationId)
          : undefined;
        await page.goto(active ? `${DISCORD_ORIGIN}${active.href}` : HOME_URL, {
          waitUntil: "domcontentloaded",
        });
      });
    } catch (error) {
      this.guildScanDetail = error instanceof Error ? error.message : String(error);
    } finally {
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
