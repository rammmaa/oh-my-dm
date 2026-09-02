export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", aliases: ["h"], description: "명령과 단축키 보기", usage: "/help" },
  { name: "open", aliases: ["o"], description: "이름으로 대화방 열기", usage: "/open <이름>" },
  {
    name: "conversations",
    aliases: ["chats", "ls"],
    description: "대화방 목록 보기",
    usage: "/conversations",
  },
  { name: "unread", aliases: ["u"], description: "안 읽은 대화만 보기", usage: "/unread" },
  { name: "all", aliases: ["a"], description: "모든 대화 보기", usage: "/all" },
  {
    name: "connectors",
    aliases: ["status", "s"],
    description: "채팅 connector 연결 상태 보기",
    usage: "/connectors",
  },
  {
    name: "history",
    aliases: ["older"],
    description: "과거 대화 내역 열기",
    usage: "/history",
  },
  { name: "model", aliases: ["models"], description: "표시할 모델 선택", usage: "/model [이름]" },
  { name: "theme", aliases: ["themes"], description: "UI 색상 테마 선택", usage: "/theme [이름]" },
  { name: "refresh", aliases: ["r"], description: "connector 화면 다시 읽기", usage: "/refresh" },
  { name: "clear", aliases: ["c"], description: "현재 메시지 화면 비우기", usage: "/clear" },
  { name: "exit", aliases: ["quit", "q"], description: "oh-my-dm 종료", usage: "/exit" },
];

export type ParsedSubmission =
  | { kind: "empty" }
  | { kind: "message"; text: string }
  | { kind: "command"; name: string; args: string[] };

export function parseSubmission(value: string): ParsedSubmission {
  const trimmed = value.trim();
  if (!trimmed) return { kind: "empty" };
  if (trimmed.startsWith("//")) return { kind: "message", text: trimmed.slice(1) };
  if (!trimmed.startsWith("/")) return { kind: "message", text: trimmed };

  const [name = "", ...args] = trimmed.slice(1).trimStart().split(/\s+/);
  return { kind: "command", name: name.toLowerCase(), args };
}

export function filterSlashCommands(value: string): SlashCommand[] {
  if (!value.startsWith("/") || value.startsWith("//")) return [];
  const query = value.slice(1).trimStart().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!query) return SLASH_COMMANDS;

  return SLASH_COMMANDS.filter(
    (command) =>
      command.name.startsWith(query) ||
      command.aliases?.some((alias) => alias.startsWith(query)) ||
      command.description.toLowerCase().includes(query),
  );
}

export function findSlashCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find(
    (command) => command.name === name || command.aliases?.includes(name),
  );
}

export function wrapSelectionIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (index + delta + length) % length;
}

export interface SelectionWindow<T> {
  items: T[];
  start: number;
  end: number;
}

export function getSelectionWindow<T>(
  items: T[],
  selectedIndex: number,
  windowSize: number,
): SelectionWindow<T> {
  const size = Math.max(1, Math.min(windowSize, items.length));
  const maxStart = Math.max(0, items.length - size);
  const start = Math.min(maxStart, Math.max(0, selectedIndex - size + 1));
  const end = start + size;
  return { items: items.slice(start, end), start, end };
}
