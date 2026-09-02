import fs from "node:fs/promises";
import path from "node:path";

export interface UiSettings {
  theme?: string;
  model?: string;
  modelEffort?: string;
}

export class SettingsStore {
  public constructor(private readonly filePath: string) {}

  public async load(): Promise<UiSettings> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as UiSettings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  public async save(settings: UiSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, this.filePath);
  }
}
