import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { getAppPaths } from "../src/config.js";

test("Instagram과 Discord 브라우저 프로필을 data 디렉터리 아래에 나눠 둔다", () => {
  const paths = getAppPaths({ OH_MY_DM_DATA: "/tmp/oh-my-dm-config-test" });
  assert.equal(paths.dataDir, path.resolve("/tmp/oh-my-dm-config-test"));
  assert.equal(paths.browserProfileDir, path.join(paths.dataDir, "browser", "instagram"));
  assert.equal(paths.discordProfileDir, path.join(paths.dataDir, "browser", "discord"));
  assert.equal(paths.settingsFile, path.join(paths.dataDir, "settings.json"));
});
