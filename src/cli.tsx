#!/usr/bin/env node
import fs from "node:fs/promises";

import { render } from "ink";
import React from "react";

import { resolveBrowserExecutable } from "./browser/resolve-browser.js";
import { getAppPaths, parseProviderList } from "./config.js";
import { DiscordWebConnector } from "./connectors/discord-web.js";
import { InstagramWebConnector } from "./connectors/instagram-web.js";
import { KakaoNativeConnector } from "./connectors/kakao-native.js";
import { UnifiedChatConnector } from "./connectors/unified.js";
import type { ChatConnector } from "./domain.js";
import { SettingsStore } from "./storage/settings-store.js";
import { App } from "./ui/app.js";
import { resolveLanguage } from "./ui/i18n.js";
import { checkForUpdate, installLatestVersion } from "./update.js";
import { APP_VERSION } from "./version.js";

const paths = getAppPaths();
const [command = "chat", provider = "instagram"] = process.argv.slice(2);

const WEB_PROVIDERS = {
  instagram: { label: "Instagram" },
  discord: { label: "Discord" },
} as const;
type WebProvider = keyof typeof WEB_PROVIDERS;

function isWebProvider(value: string): value is WebProvider {
  return Object.hasOwn(WEB_PROVIDERS, value);
}

function profileDirFor(webProvider: WebProvider): string {
  return webProvider === "discord" ? paths.discordProfileDir : paths.browserProfileDir;
}

function createWebConnector(
  webProvider: WebProvider,
  headless: boolean,
  cloneProfileWhenLocked: boolean,
): ChatConnector {
  const options = { profileDir: profileDirFor(webProvider), headless, cloneProfileWhenLocked };
  return webProvider === "discord"
    ? new DiscordWebConnector(options)
    : new InstagramWebConnector(options);
}

await removeLegacySnapshot(paths.dataDir);
const settingsStore = new SettingsStore(paths.settingsFile);
const settings = await settingsStore.load();
const cliLanguage = resolveLanguage(settings.language);
const cliText = cliLanguage === "ko" ? {
  unsupportedProvider: (value: string) => `지원하지 않는 provider입니다: ${value}`,
  login: "로그인용 Playwright Chromium을 엽니다. 로그인을 마친 뒤 Ctrl+C로 종료하세요.",
  chatBrowser: "chat browser: Playwright Chromium Headless (Dock 아이콘 없음)",
  logout: (label: string) => `${label} 전용 브라우저 프로필을 삭제했습니다.`,
  updating: "oh-my-dm을 최신 버전으로 업데이트합니다…",
  updated: "업데이트가 완료됐습니다. oh-my-dm을 다시 실행하세요.",
  help: `사용법:\n  oh-my-dm                  TUI 실행\n  oh-my-dm login instagram  Instagram 로그인 세션 생성\n  oh-my-dm login discord    Discord 로그인 세션 생성\n  oh-my-dm update           최신 버전 설치\n  oh-my-dm doctor           로컬 설정 확인\n  oh-my-dm logout instagram Instagram 로그인 세션 삭제\n  oh-my-dm logout discord   Discord 로그인 세션 삭제\n\n옵션:\n  --headed                   디버깅용 브라우저 창 표시\n\n환경 변수:\n  OH_MY_DM_PROVIDERS         켤 connector를 쉼표로 지정 (예: discord)`,
} : {
  unsupportedProvider: (value: string) => `Unsupported provider: ${value}`,
  login: "Opening Playwright Chromium for login. When finished, press Ctrl+C to exit.",
  chatBrowser: "chat browser: Playwright Chromium Headless (no Dock icon)",
  logout: (label: string) => `Deleted the dedicated ${label} browser profile.`,
  updating: "Updating oh-my-dm to the latest version…",
  updated: "Update complete. Restart oh-my-dm.",
  help: `Usage:\n  oh-my-dm                  Start the TUI\n  oh-my-dm login instagram  Create an Instagram login session\n  oh-my-dm login discord    Create a Discord login session\n  oh-my-dm update           Install the latest version\n  oh-my-dm doctor           Check the local setup\n  oh-my-dm logout instagram Delete the Instagram login session\n  oh-my-dm logout discord   Delete the Discord login session\n\nOptions:\n  --headed                   Show the browser window for debugging\n\nEnvironment:\n  OH_MY_DM_PROVIDERS         Comma-separated connectors to load (e.g. discord)`,
};
let runtimeSettings = settings;
let settingsSaveQueue = Promise.resolve();
const saveSettings = (patch: Partial<typeof settings>): Promise<void> => {
  runtimeSettings = { ...runtimeSettings, ...patch };
  const nextSettings = runtimeSettings;
  settingsSaveQueue = settingsSaveQueue
    .catch(() => undefined)
    .then(() => settingsStore.save(nextSettings));
  return settingsSaveQueue;
};

if (command !== "chat" && !isWebProvider(provider)) {
  console.error(cliText.unsupportedProvider(provider));
  process.exitCode = 1;
} else if (command === "chat") {
  const availableUpdateVersion =
    process.env.OH_MY_DM_PREVIEW_UPDATE
      ? "preview"
      : process.env.CI ||
    process.env.NO_UPDATE_NOTIFIER ||
    process.env.OH_MY_DM_NO_UPDATE_CHECK ||
    process.env.npm_lifecycle_event === "dev"
      ? undefined
      : await checkForUpdate(APP_VERSION);
  let updateRequested = false;
  let autoUpdatePromise: Promise<void> | undefined;
  const startAutoUpdate = (): Promise<void> => {
    if (!autoUpdatePromise) {
      autoUpdatePromise = installLatestVersion({ silent: true }).catch((error) => {
        autoUpdatePromise = undefined;
        throw error;
      });
    }
    return autoUpdatePromise;
  };
  const headless = !process.argv.includes("--headed");
  const connectorFactories: { id: string; label: string; source: string; create: () => ChatConnector }[] = [
    {
      id: "instagram",
      label: "Instagram",
      source: "instagram.com/direct · live DOM + WebSocket",
      create: () => createWebConnector("instagram", headless, true),
    },
    {
      id: "kakaotalk",
      label: "KakaoTalk",
      source: "KakaoTalk for macOS · persistent native bridge",
      create: () => new KakaoNativeConnector(),
    },
    {
      id: "discord",
      label: "Discord",
      source: "discord.com/channels · live DOM + WebSocket",
      create: () => createWebConnector("discord", headless, true),
    },
  ];
  // Only build the connectors the user asked for. An unknown or empty list
  // falls back to every connector so the default experience is unchanged.
  const requestedProviders = parseProviderList(process.env.OH_MY_DM_PROVIDERS);
  const selectedFactories = requestedProviders.length
    ? connectorFactories.filter((factory) => requestedProviders.includes(factory.id))
    : connectorFactories;
  const activeFactories = selectedFactories.length ? selectedFactories : connectorFactories;
  const connector = new UnifiedChatConnector(
    activeFactories.map((factory) => ({
      id: factory.id,
      label: factory.label,
      source: factory.source,
      connector: factory.create(),
    })),
  );
  const app = render(
    <App
      connector={connector}
      initialThemeId={settings.theme}
      initialModelId={settings.model}
      initialModelEffort={settings.modelEffort}
      initialLanguage={settings.language}
      availableUpdateVersion={availableUpdateVersion}
      onAutoUpdate={
        availableUpdateVersion &&
        availableUpdateVersion !== "preview" &&
        !process.env.OH_MY_DM_NO_AUTO_UPDATE
          ? startAutoUpdate
          : undefined
      }
      onThemeChange={(theme) => saveSettings({ theme })}
      onModelChange={(model, modelEffort) => saveSettings({ model, modelEffort })}
      onLanguageChange={(language) => saveSettings({ language })}
      onUpdate={() => { updateRequested = true; }}
    />,
    {
      maxFps: 120,
    },
  );
  // Ink's exit() resolves before React's async effect cleanup can finish.
  // Keep the CLI alive just long enough to close browser/native bridge handles,
  // otherwise they survive as orphans and continue driving KakaoTalk.
  await app.waitUntilExit();
  await connector.stop();
  if (updateRequested) {
    console.log(cliText.updating);
    await (autoUpdatePromise ?? installLatestVersion());
    console.log(cliText.updated);
  }
} else if (command === "login" && isWebProvider(provider)) {
  console.log(cliText.login);
  const connector = createWebConnector(provider, false, false);
  await connector.start();
  await waitForSignal();
  await connector.stop();
} else if (command === "doctor") {
  const browser = resolveBrowserExecutable();
  console.log(`data: ${paths.dataDir}`);
  console.log(`profile: ${paths.browserProfileDir}`);
  console.log(`discord profile: ${paths.discordProfileDir}`);
  console.log(`login browser: ${browser.label} (${browser.executablePath})`);
  console.log(cliText.chatBrowser);
  console.log("runtime: Instagram web + Discord web + KakaoTalk native bridge / no message persistence");
} else if (command === "update") {
  console.log(cliText.updating);
  await installLatestVersion();
  console.log(cliText.updated);
} else if (command === "logout" && isWebProvider(provider)) {
  await fs.rm(profileDirFor(provider), { recursive: true, force: true });
  console.log(cliText.logout(WEB_PROVIDERS[provider].label));
} else {
  console.log(`oh-my-dm\n\n${cliText.help}`);
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

async function removeLegacySnapshot(dataDir: string): Promise<void> {
  try {
    await fs.unlink(`${dataDir}/snapshot.json`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
