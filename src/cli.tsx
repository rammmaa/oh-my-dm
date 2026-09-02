#!/usr/bin/env node
import fs from "node:fs/promises";

import { render } from "ink";
import React from "react";

import { resolveBrowserExecutable } from "./browser/resolve-browser.js";
import { getAppPaths } from "./config.js";
import { InstagramWebConnector } from "./connectors/instagram-web.js";
import { KakaoNativeConnector } from "./connectors/kakao-native.js";
import { UnifiedChatConnector } from "./connectors/unified.js";
import { SettingsStore } from "./storage/settings-store.js";
import { App } from "./ui/app.js";
import { resolveLanguage } from "./ui/i18n.js";

const paths = getAppPaths();
const [command = "chat", provider = "instagram"] = process.argv.slice(2);

await removeLegacySnapshot(paths.dataDir);
const settingsStore = new SettingsStore(paths.settingsFile);
const settings = await settingsStore.load();
const cliLanguage = resolveLanguage(settings.language);
const cliText = cliLanguage === "ko" ? {
  unsupportedProvider: (value: string) => `지원하지 않는 provider입니다: ${value}`,
  login: "로그인용 Chrome을 엽니다. 로그인을 마친 뒤 Ctrl+C로 종료하세요.",
  chatBrowser: "chat browser: Chromium Headless Shell (Dock 아이콘 없음)",
  logout: "Instagram 전용 브라우저 프로필을 삭제했습니다.",
  help: `사용법:\n  oh-my-dm                 TUI 실행\n  oh-my-dm login instagram 로그인 세션 생성\n  oh-my-dm doctor          로컬 설정 확인\n  oh-my-dm logout instagram 로그인 세션 삭제\n\n옵션:\n  --headed                   디버깅용 브라우저 창 표시`,
} : {
  unsupportedProvider: (value: string) => `Unsupported provider: ${value}`,
  login: "Opening Chrome for login. When you are finished, press Ctrl+C to exit.",
  chatBrowser: "chat browser: Chromium Headless Shell (no Dock icon)",
  logout: "Deleted the dedicated Instagram browser profile.",
  help: `Usage:\n  oh-my-dm                 Start the TUI\n  oh-my-dm login instagram Create a login session\n  oh-my-dm doctor          Check the local setup\n  oh-my-dm logout instagram Delete the login session\n\nOptions:\n  --headed                   Show the browser window for debugging`,
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

if (provider !== "instagram" && command !== "chat") {
  console.error(cliText.unsupportedProvider(provider));
  process.exitCode = 1;
} else if (command === "chat") {
  const instagram = new InstagramWebConnector({
    profileDir: paths.browserProfileDir,
    headless: !process.argv.includes("--headed"),
  });
  const connector = new UnifiedChatConnector([
    { id: "instagram", label: "Instagram", connector: instagram },
    { id: "kakaotalk", label: "KakaoTalk", connector: new KakaoNativeConnector() },
  ]);
  render(
    <App
      connector={connector}
      initialThemeId={settings.theme}
      initialModelId={settings.model}
      initialModelEffort={settings.modelEffort}
      initialLanguage={settings.language}
      onThemeChange={(theme) => saveSettings({ theme })}
      onModelChange={(model, modelEffort) => saveSettings({ model, modelEffort })}
      onLanguageChange={(language) => saveSettings({ language })}
    />,
    {
      maxFps: 120,
    },
  );
} else if (command === "login") {
  console.log(cliText.login);
  const connector = new InstagramWebConnector({
    profileDir: paths.browserProfileDir,
    headless: false,
  });
  await connector.start();
  await waitForSignal();
  await connector.stop();
} else if (command === "doctor") {
  const browser = resolveBrowserExecutable();
  console.log(`data: ${paths.dataDir}`);
  console.log(`profile: ${paths.browserProfileDir}`);
  console.log(`login browser: ${browser.label} (${browser.executablePath})`);
  console.log(cliText.chatBrowser);
  console.log("runtime: Instagram web + KakaoTalk native bridge / no message persistence");
} else if (command === "logout") {
  await fs.rm(paths.browserProfileDir, { recursive: true, force: true });
  console.log(cliText.logout);
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
