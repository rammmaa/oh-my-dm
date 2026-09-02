import fs from "node:fs";
import path from "node:path";

export interface BrowserExecutable {
  label: string;
  executablePath: string;
}

export function resolveBrowserExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): BrowserExecutable {
  const configuredBrowser = env.OH_MY_DM_BROWSER ?? env.OH_MY_CHAT_BROWSER;
  if (configuredBrowser) {
    const executablePath = path.resolve(configuredBrowser);
    if (!fs.existsSync(executablePath)) {
      throw new Error(`OH_MY_DM_BROWSER 경로를 찾을 수 없습니다: ${executablePath}`);
    }
    return { label: "custom Chromium", executablePath };
  }

  for (const candidate of browserCandidates(platform, env)) {
    if (fs.existsSync(candidate.executablePath)) return candidate;
  }

  throw new Error(
    "Chrome, Chromium, Brave 또는 Edge를 찾지 못했습니다. OH_MY_DM_BROWSER에 실행 파일 경로를 지정하세요.",
  );
}

function browserCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): BrowserExecutable[] {
  if (platform === "darwin") {
    return [
      browser("Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      browser("Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"),
      browser("Brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
      browser("Microsoft Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ];
  }

  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? "";
    const programs = env.PROGRAMFILES ?? "";
    return [
      browser("Google Chrome", path.join(programs, "Google", "Chrome", "Application", "chrome.exe")),
      browser("Brave", path.join(programs, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
      browser("Microsoft Edge", path.join(programs, "Microsoft", "Edge", "Application", "msedge.exe")),
      browser("Google Chrome", path.join(local, "Google", "Chrome", "Application", "chrome.exe")),
    ];
  }

  return [
    browser("Google Chrome", "/usr/bin/google-chrome"),
    browser("Google Chrome", "/usr/bin/google-chrome-stable"),
    browser("Chromium", "/usr/bin/chromium"),
    browser("Chromium", "/usr/bin/chromium-browser"),
    browser("Brave", "/usr/bin/brave-browser"),
    browser("Microsoft Edge", "/usr/bin/microsoft-edge"),
  ];
}

function browser(label: string, executablePath: string): BrowserExecutable {
  return { label, executablePath };
}
