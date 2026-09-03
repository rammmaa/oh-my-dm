export interface MessageWindow<T> {
  items: T[];
  start: number;
  end: number;
  maxOffset: number;
}

export function getOlderMessageOffset(
  currentOffset: number,
  maxOffset: number,
  visibleItemCount: number,
  byPage: boolean,
): number {
  const step = byPage ? Math.max(1, visibleItemCount) : 1;
  return Math.min(maxOffset, currentOffset + step);
}

export function getMessageWindow<T>(
  items: T[],
  visibleRows: number,
  offsetFromBottom: number,
  getRowCount: (item: T) => number = () => 1,
): MessageWindow<T> {
  const rowBudget = Math.max(1, visibleRows);
  let firstWindowEnd = 0;
  let firstWindowRows = 0;
  while (firstWindowEnd < items.length) {
    const rows = Math.max(1, getRowCount(items[firstWindowEnd]!));
    if (firstWindowEnd > 0 && firstWindowRows + rows > rowBudget) break;
    firstWindowRows += rows;
    firstWindowEnd += 1;
  }

  const maxOffset = Math.max(0, items.length - firstWindowEnd);
  const offset = Math.max(0, Math.min(offsetFromBottom, maxOffset));
  const end = Math.max(0, items.length - offset);
  let start = end;
  let usedRows = 0;
  while (start > 0) {
    const rows = Math.max(1, getRowCount(items[start - 1]!));
    if (start < end && usedRows + rows > rowBudget) break;
    usedRows += rows;
    start -= 1;
  }
  return { items: items.slice(start, end), start, end, maxOffset };
}
