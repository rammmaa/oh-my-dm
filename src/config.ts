import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AppPaths {
  dataDir: string;
  browserProfileDir: string;
  discordProfileDir: string;
  settingsFile: string;
}

// OH_MY_DM_PROVIDERS is a comma-separated allow-list of connector ids to load
// (e.g. "discord" or "discord,instagram"). An empty value means load them all.
export function parseProviderList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

export function getAppPaths(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const newDefault = path.join(os.homedir(), ".oh-my-dm");
  const legacyDefault = path.join(os.homedir(), ".oh-my-chat");
  const configuredDataDir = env.OH_MY_DM_DATA ?? env.OH_MY_CHAT_DATA;
  const dataDir = configuredDataDir
    ? path.resolve(configuredDataDir)
    : existsSync(newDefault) || !existsSync(legacyDefault)
      ? newDefault
      : legacyDefault;

  return {
    dataDir,
    browserProfileDir: path.join(dataDir, "browser", "instagram"),
    discordProfileDir: path.join(dataDir, "browser", "discord"),
    settingsFile: path.join(dataDir, "settings.json"),
  };
}
