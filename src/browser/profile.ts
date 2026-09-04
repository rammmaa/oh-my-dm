import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function isProfileLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ProcessSingleton|profile (?:appears to be|is) in use|user data directory is already in use/i.test(message);
}

// Copy a persistent Chromium profile without its singleton lock files so a
// second oh-my-dm process can reuse the same login session.
export async function cloneBrowserProfile(
  sourceProfileDir: string,
  temporaryRoot = os.tmpdir(),
  prefix = "oh-my-dm-profile-",
): Promise<{ profileDir: string; cleanupDir: string }> {
  const cleanupDir = await fs.mkdtemp(path.join(temporaryRoot, prefix));
  const profileDir = path.join(cleanupDir, "profile");
  try {
    await fs.cp(sourceProfileDir, profileDir, {
      recursive: true,
      filter: (source) => !path.basename(source).startsWith("Singleton"),
    });
    return { profileDir, cleanupDir };
  } catch (error) {
    await fs.rm(cleanupDir, { recursive: true, force: true });
    throw error;
  }
}
