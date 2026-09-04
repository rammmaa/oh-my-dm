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

export function shouldShowComposerHints(terminalColumns: number, input: string): boolean {
  return terminalColumns >= 72 && input.length === 0;
}

export interface ConversationLayout {
  contentWidth: number;
  pathWidth: number;
  tabsWidth: number;
  compactTabs: boolean;
  showPreview: boolean;
  titleWidth: number;
  previewWidth: number;
}

export const DEFAULT_CONNECTOR_LABELS: readonly string[] = ["Instagram", "KakaoTalk"];

export function getConversationLayout(
  terminalColumns: number,
  connectorLabels: readonly string[] = DEFAULT_CONNECTOR_LABELS,
): ConversationLayout {
  const contentWidth = Math.max(1, terminalColumns - 6);
  const showPreview = terminalColumns >= 70;
  const labels = connectorLabels.length > 0 ? connectorLabels : DEFAULT_CONNECTOR_LABELS;
  // Each tab renders as " Label " and tabs are joined with " │ ".
  const separatorWidth = 3 * (labels.length - 1);
  const regularTabsWidth =
    labels.reduce((total, label) => total + stringWidth(label) + 2, 0) + separatorWidth;
  const compactTabsWidth = labels.length * 3 + separatorWidth;
  const compactTabs = contentWidth <= regularTabsWidth;
  const tabsWidth = Math.min(contentWidth, compactTabs ? compactTabsWidth : regularTabsWidth);
  const pathWidth = Math.max(0, contentWidth - tabsWidth);
  const titleWidth = showPreview
    ? Math.max(8, Math.min(32, Math.floor(contentWidth * 0.38)))
    : Math.max(1, contentWidth - 5);
  const previewWidth = showPreview
    ? Math.max(1, contentWidth - 5 - titleWidth)
    : 0;

  return {
    contentWidth,
    pathWidth,
    tabsWidth,
    compactTabs,
    showPreview,
    titleWidth,
    previewWidth,
  };
}
