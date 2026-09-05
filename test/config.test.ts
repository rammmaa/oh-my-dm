import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { getAppPaths, parseDiscordChannelPins, parseProviderList } from "../src/config.js";

test("Instagram과 Discord 브라우저 프로필을 data 디렉터리 아래에 나눠 둔다", () => {
  const paths = getAppPaths({ OH_MY_DM_DATA: "/tmp/oh-my-dm-config-test" });
  assert.equal(paths.dataDir, path.resolve("/tmp/oh-my-dm-config-test"));
  assert.equal(paths.browserProfileDir, path.join(paths.dataDir, "browser", "instagram"));
  assert.equal(paths.discordProfileDir, path.join(paths.dataDir, "browser", "discord"));
  assert.equal(paths.settingsFile, path.join(paths.dataDir, "settings.json"));
});

test("OH_MY_DM_PROVIDERS 값을 connector id 목록으로 나눈다", () => {
  assert.deepEqual(parseProviderList("discord"), ["discord"]);
  assert.deepEqual(parseProviderList(" Discord , Instagram "), ["discord", "instagram"]);
  assert.deepEqual(parseProviderList(undefined), []);
  assert.deepEqual(parseProviderList(""), []);
  assert.deepEqual(parseProviderList(",, ,"), []);
});

test("OH_MY_DM_DISCORD_CHANNELS를 서버·채널 id 쌍으로 나눈다", () => {
  assert.deepEqual(
    parseDiscordChannelPins("https://discord.com/channels/1538517028644855818/1544000000000000001"),
    [{ guildId: "1538517028644855818", channelId: "1544000000000000001" }],
  );
  assert.deepEqual(
    parseDiscordChannelPins("1538517028644855818/1544000000000000001=아파트 rammmmi"),
    [{ guildId: "1538517028644855818", channelId: "1544000000000000001", label: "아파트 rammmmi" }],
  );
  assert.deepEqual(
    parseDiscordChannelPins("channels/11111111111111111/22222222222222222 , bad, 33333333333333333/44444444444444444"),
    [
      { guildId: "11111111111111111", channelId: "22222222222222222" },
      { guildId: "33333333333333333", channelId: "44444444444444444" },
    ],
  );
  assert.deepEqual(parseDiscordChannelPins(undefined), []);
  assert.deepEqual(parseDiscordChannelPins("nonsense"), []);
});
