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

export interface DiscordChannelPin {
  guildId: string;
  channelId: string;
  label?: string;
}

// OH_MY_DM_DISCORD_CHANNELS pins channels or threads that the normal scan does
// not list, such as posts inside a forum channel. Each comma-separated entry is
// a Discord channel URL or a "guildId/channelId" pair, with an optional
// "=Label" for the name shown in the list (e.g. ".../123/456=아파트 rammmmi").
export function parseDiscordChannelPins(value: string | undefined): DiscordChannelPin[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const separator = entry.indexOf("=");
      const locator = separator === -1 ? entry : entry.slice(0, separator);
      const label = separator === -1 ? "" : entry.slice(separator + 1).trim();
      const match = locator.match(/(\d{15,})\/(\d{15,})/);
      if (!match) return [];
      return [{
        guildId: match[1]!,
        channelId: match[2]!,
        ...(label ? { label } : {}),
      }];
    });
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
