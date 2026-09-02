import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

export function formatUserMessageLines(text: string, width: number): string[] {
  const lineWidth = Math.max(8, width);
  const contentWidth = Math.max(4, lineWidth - 2);
  return wrapAnsi(`› ${text.replaceAll("\n", " ")}`, contentWidth, {
    hard: true,
    trim: false,
    wordWrap: true,
  })
    .split("\n")
    .map((line) => {
      const content = ` ${line}`;
      return content + " ".repeat(Math.max(1, lineWidth - stringWidth(content)));
    });
}
