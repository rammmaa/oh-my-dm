import stringWidth from "string-width";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function truncateToWidth(value: string, maxWidth: number): string {
  const width = Math.max(0, maxWidth);
  if (stringWidth(value) <= width) return value;
  if (width === 0) return "";
  if (width === 1) return "…";

  let result = "";
  for (const { segment } of segmenter.segment(value)) {
    if (stringWidth(result + segment) > width - 1) break;
    result += segment;
  }
  return `${result}…`;
}

export function padToWidth(value: string, width: number): string {
  const truncated = truncateToWidth(value, width);
  return truncated + " ".repeat(Math.max(0, width - stringWidth(truncated)));
}
