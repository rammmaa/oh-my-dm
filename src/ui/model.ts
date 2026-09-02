export type ModelEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface DisplayModel {
  id: string;
  label: string;
  source: string;
  aliases?: string[];
  efforts?: ModelEffort[];
  defaultEffort?: ModelEffort;
}

const FULL_EFFORTS: ModelEffort[] = ["low", "medium", "high", "xhigh", "max", "ultra"];

export const DISPLAY_MODELS: DisplayModel[] = [
  { id: "opus-5", label: "Opus 5", source: "Claude", aliases: ["opus"] },
  { id: "sonnet-5", label: "Sonnet 5", source: "Claude", aliases: ["sonnet"] },
  { id: "haiku-4.5", label: "Haiku 4.5", source: "Claude", aliases: ["haiku"] },
  {
    id: "gpt-5.6-sol",
    label: "gpt-5.6-sol",
    source: "Codex",
    aliases: ["sol"],
    efforts: FULL_EFFORTS,
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.6-terra",
    label: "gpt-5.6-terra",
    source: "Codex",
    aliases: ["terra"],
    efforts: FULL_EFFORTS,
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.6-luna",
    label: "gpt-5.6-luna",
    source: "Codex",
    aliases: ["luna"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
];

export const DEFAULT_MODEL_ID = "opus-5";

export function findDisplayModel(value: string): DisplayModel | undefined {
  const query = value.trim().toLowerCase();
  return DISPLAY_MODELS.find(
    (model) =>
      model.id === query ||
      model.label.toLowerCase() === query ||
      model.aliases?.includes(query) ||
      model.efforts?.some(
        (effort) => query === `${model.id}-${effort}` || query === `${model.label.toLowerCase()} ${effort}`,
      ),
  );
}

export function getDisplayModel(value?: string): DisplayModel {
  return findDisplayModel(value ?? "") ?? DISPLAY_MODELS[0]!;
}

export function effortFromModelValue(value?: string): ModelEffort | undefined {
  if (!value) return undefined;
  const query = value.trim().toLowerCase();
  return FULL_EFFORTS.find(
    (effort) => query.endsWith(`-${effort}`) || query.endsWith(` ${effort}`),
  );
}

export function formatDisplayModel(model: DisplayModel, effort?: ModelEffort): string {
  return effort && model.efforts?.includes(effort) ? `${model.label} ${effort}` : model.label;
}
