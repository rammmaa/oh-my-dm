import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";

export interface BrowserExecutable {
  label: string;
  executablePath: string;
}

export function resolveBrowserExecutable(
  env: NodeJS.ProcessEnv = process.env,
  bundledPath: string = chromium.executablePath(),
  exists: (filePath: string) => boolean = fs.existsSync,
): BrowserExecutable {
  const configuredBrowser = env.OH_MY_DM_BROWSER ?? env.OH_MY_CHAT_BROWSER;
  if (configuredBrowser) {
    const executablePath = path.resolve(configuredBrowser);
    if (!exists(executablePath)) {
      throw new Error(`OH_MY_DM_BROWSER 경로를 찾을 수 없습니다: ${executablePath}`);
    }
    return { label: "custom Chromium", executablePath };
  }

  if (!exists(bundledPath)) {
    throw new Error(
      "Playwright Chromium을 찾을 수 없습니다. npm install script를 허용해 다시 설치하세요.",
    );
  }
  return { label: "Playwright Chromium", executablePath: bundledPath };
}
