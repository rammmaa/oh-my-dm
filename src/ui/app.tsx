import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

import type { ChatConnector, ChatSnapshot, Conversation } from "../domain.js";
import { APP_VERSION } from "../version.js";
import { getMessageWindow } from "./message-window.js";
import {
  filterSlashCommands,
  findSlashCommand,
  getSelectionWindow,
  parseSubmission,
  SLASH_COMMANDS,
  type SlashCommand,
  wrapSelectionIndex,
} from "./slash-commands.js";
import {
  CONNECTOR_COLORS,
  DEFAULT_THEME_ID,
  findTheme,
  getTheme,
  UI_THEMES,
  type UiTheme,
} from "./theme.js";
import {
  DEFAULT_MODEL_ID,
  DISPLAY_MODELS,
  effortFromModelValue,
  findDisplayModel,
  formatDisplayModel,
  getDisplayModel,
  type DisplayModel,
  type ModelEffort,
} from "./model.js";
import { padToWidth, truncateToWidth } from "./text-layout.js";
import { formatUserMessageLines } from "./user-message.js";
import { ImeTextInput } from "./ime-text-input.js";

interface AppProps {
  connector: ChatConnector;
  initialThemeId?: string;
  initialModelId?: string;
  initialModelEffort?: string;
  onThemeChange?: (themeId: string) => void | Promise<void>;
  onModelChange?: (modelId: string, effort?: ModelEffort) => void | Promise<void>;
}

type ConversationFilter = "all" | "unread";
type ViewMode = "chat" | "history" | "conversations" | "connectors" | "model" | "effort" | "theme";
type TranscriptItem =
  | { id: string; kind: "signature"; full: boolean }
  | { id: string; kind: "message"; message: ChatSnapshot["messages"][number] };

export function App({
  connector,
  initialThemeId,
  initialModelId,
  initialModelEffort,
  onThemeChange,
  onModelChange,
}: AppProps) {
  const { exit } = useApp();
  const { stdout, write } = useStdout();
  const terminalSize = useTerminalSize(stdout);
  const [snapshot, setSnapshot] = useState(connector.getSnapshot());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [messagesHidden, setMessagesHidden] = useState(false);
  const [workspaceCleared, setWorkspaceCleared] = useState(false);
  const [messageOffset, setMessageOffset] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [themeId, setThemeId] = useState(() => getTheme(initialThemeId ?? DEFAULT_THEME_ID).id);
  const [themeIndex, setThemeIndex] = useState(0);
  const [modelId, setModelId] = useState(() => getDisplayModel(initialModelId ?? DEFAULT_MODEL_ID).id);
  const [modelIndex, setModelIndex] = useState(0);
  const [modelEffort, setModelEffort] = useState<ModelEffort | undefined>(() => {
    const initialModel = getDisplayModel(initialModelId ?? DEFAULT_MODEL_ID);
    const requestedEffort = effortFromModelValue(initialModelEffort ?? initialModelId);
    return requestedEffort && initialModel.efforts?.includes(requestedEffort)
      ? requestedEffort
      : initialModel.defaultEffort;
  });
  const [effortModelId, setEffortModelId] = useState(() => getDisplayModel(initialModelId ?? DEFAULT_MODEL_ID).id);
  const [effortIndex, setEffortIndex] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([
    { id: "signature", kind: "signature", full: terminalSize.columns >= 48 },
  ]);
  const [transcriptEpoch, setTranscriptEpoch] = useState(0);
  const [conversationOpenEpoch, setConversationOpenEpoch] = useState(0);
  const transcriptConversation = useRef<string | undefined>(undefined);
  const emittedMessageIds = useRef(new Set<string>());
  const olderLoadInProgress = useRef(false);
  const historyAlternateScreen = useRef(false);
  const commandAlternateScreen = useRef(false);
  const pendingAfterCommandScreen = useRef<(() => void) | undefined>(undefined);
  const theme = getTheme(themeId);
  const displayModel = getDisplayModel(modelId);
  const displayModelLabel = formatDisplayModel(displayModel, modelEffort);
  const effortModel = getDisplayModel(effortModelId);

  const commandMode = input.startsWith("/") && !input.startsWith("//");
  const commandMatches = useMemo(() => filterSlashCommands(input), [input]);
  const commandWindowSize = Math.max(
    3,
    Math.min(8, Math.floor((terminalSize.rows - 14) / 2)),
  );
  const showSignature = terminalSize.columns >= 48;
  const signatureExtraRows = (showSignature ? 2 : 0) + 1;
  const chatViewReservedRows = viewMode === "chat" ? 1 : 0;
  const mainHeight = Math.max(
    6,
    terminalSize.rows -
      (commandMode
        ? commandWindowSize + 9 + chatViewReservedRows
        : 6 + chatViewReservedRows) -
      signatureExtraRows,
  );
  const visibleMessageCount = Math.max(1, mainHeight - 4);
  const messageContentWidth = Math.max(20, terminalSize.columns - 2);
  const conversationContentWidth = Math.max(24, terminalSize.columns - 6);
  const transcriptRows = useMemo(
    () =>
      transcript.reduce((rows, item) => {
        if (item.kind === "signature") return rows + (item.full ? 4 : 2);
        const messageText = item.message.text.replaceAll("\n", " ");
        const messageRows =
          item.message.sender === "나"
            ? formatUserMessageLines(messageText, messageContentWidth).length
            : Math.max(
                1,
                Math.ceil(
                  stringWidth(`${item.message.sender}: ${messageText}`) / messageContentWidth,
                ),
              );
        return rows + messageRows + 1;
      }, 0),
    [messageContentWidth, transcript],
  );
  const messageWindow = useMemo(
    () =>
      getMessageWindow(snapshot.messages, visibleMessageCount, messageOffset, (message) =>
        message.sender === "나"
          ? formatUserMessageLines(message.text, messageContentWidth).length
          : wrapTerminalLines(
              `${message.sender}: ${message.text.replaceAll("\n", " ")}`,
              conversationContentWidth,
            ).length,
      ),
    [
      conversationContentWidth,
      messageContentWidth,
      messageOffset,
      snapshot.messages,
      visibleMessageCount,
    ],
  );
  const commandWindow = useMemo(
    () => getSelectionWindow(commandMatches, commandIndex, commandWindowSize),
    [commandIndex, commandMatches, commandWindowSize],
  );
  const conversations = useMemo(
    () =>
      conversationFilter === "unread"
        ? snapshot.conversations.filter((conversation) => conversation.unread)
        : snapshot.conversations,
    [conversationFilter, snapshot.conversations],
  );
  const conversationWindow = useMemo(
    () => getSelectionWindow(conversations, selectedIndex, Math.max(1, mainHeight - 2)),
    [conversations, mainHeight, selectedIndex],
  );
  const modelWindow = useMemo(
    () => getSelectionWindow(DISPLAY_MODELS, modelIndex, Math.max(1, mainHeight - 4)),
    [mainHeight, modelIndex],
  );
  const effortWindow = useMemo(
    () =>
      getSelectionWindow(
        effortModel.efforts ?? [],
        effortIndex,
        Math.max(1, mainHeight - 4),
      ),
    [effortIndex, effortModel.efforts, mainHeight],
  );
  const showConversationPreview = terminalSize.columns >= 70;
  const showComposerHints = terminalSize.columns >= 72;
  const conversationTitleWidth = Math.max(
    16,
    Math.min(32, Math.floor(conversationContentWidth * 0.38)),
  );
  const conversationPreviewWidth = Math.max(
    0,
    conversationContentWidth - 4 - conversationTitleWidth - 1,
  );

  useEffect(() => {
    const onSnapshot = (next: ChatSnapshot) => {
      // A terminal Static transcript can only append. Older messages belong in the
      // interactive history viewport; committing them here would put old data below new data.
      if (olderLoadInProgress.current) {
        for (const message of next.messages) emittedMessageIds.current.add(message.id);
      }
      setSnapshot(next);
    };
    const onError = (next: Error) => setError(next.message);
    connector.on("snapshot", onSnapshot);
    connector.on("error", onError);
    void connector.start().catch(onError);
    return () => {
      connector.off("snapshot", onSnapshot);
      connector.off("error", onError);
      void connector.stop();
    };
  }, [connector]);

  useEffect(() => {
    if (viewMode === "history" || !historyAlternateScreen.current) return;
    stdout.write("\u001B[?1049l");
    historyAlternateScreen.current = false;
    // The primary buffer was never changed. The destination frame rendered in
    // the alternate buffer is identical, so repainting it here would erase from
    // the restored IME cursor position and duplicate the footer.
  }, [stdout, viewMode]);

  useEffect(() => {
    if (commandMode || !commandAlternateScreen.current) return;
    stdout.write("\u001B[?1049l");
    commandAlternateScreen.current = false;
    const pending = pendingAfterCommandScreen.current;
    pendingAfterCommandScreen.current = undefined;
    pending?.();
  }, [commandMode, stdout]);

  useEffect(
    () => () => {
      if (historyAlternateScreen.current) stdout.write("\u001B[?1049l");
      if (commandAlternateScreen.current) stdout.write("\u001B[?1049l");
    },
    [stdout],
  );

  useEffect(() => {
    setCommandIndex(0);
  }, [input]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, conversations.length - 1)));
  }, [conversations.length]);

  useEffect(() => {
    setMessageOffset((offset) => Math.min(offset, messageWindow.maxOffset));
  }, [messageWindow.maxOffset]);

  useEffect(() => {
    setMessageOffset(0);
  }, [snapshot.activeConversationId]);

  const showError = (next: unknown): void => {
    setError(next instanceof Error ? next.message : String(next));
  };

  const applyTheme = (selectedTheme: UiTheme): void => {
    setThemeId(selectedTheme.id);
    setNotice(`theme = "${selectedTheme.id}"`);
    void Promise.resolve(onThemeChange?.(selectedTheme.id)).catch(showError);
  };

  const applyModel = (selectedModel: DisplayModel, effort?: ModelEffort): void => {
    setModelId(selectedModel.id);
    setModelEffort(effort);
    const label = formatDisplayModel(selectedModel, effort);
    setNotice(`model = "${label}"`);
    void Promise.resolve(onModelChange?.(selectedModel.id, effort)).catch(showError);
  };

  const enterHistoryScreen = (): void => {
    if (!historyAlternateScreen.current) {
      stdout.write("\u001B[?1049h\u001B[2J\u001B[H");
      historyAlternateScreen.current = true;
    }
    setViewMode("history");
  };

  const leaveHistoryScreenImmediately = (): void => {
    if (!historyAlternateScreen.current) return;
    stdout.write("\u001B[?1049l");
    historyAlternateScreen.current = false;
  };

  const chooseModel = (selectedModel: DisplayModel): void => {
    if (selectedModel.efforts?.length) {
      const selectedEffort =
        selectedModel.id === modelId && modelEffort && selectedModel.efforts.includes(modelEffort)
          ? modelEffort
          : selectedModel.defaultEffort ?? selectedModel.efforts[0]!;
      setEffortModelId(selectedModel.id);
      setEffortIndex(Math.max(0, selectedModel.efforts.indexOf(selectedEffort)));
      setViewMode("effort");
      setNotice(undefined);
      return;
    }
    applyModel(selectedModel);
    setViewMode("chat");
  };

  const openConversation = (conversation: Conversation): void => {
    leaveHistoryScreenImmediately();
    setViewMode("chat");
    setMessageOffset(0);
    setMessagesHidden(true);
    setWorkspaceCleared(false);
    transcriptConversation.current = undefined;
    emittedMessageIds.current.clear();
    setTranscript([
      { id: "signature", kind: "signature", full: terminalSize.columns >= 48 },
    ]);
    setTranscriptEpoch((epoch) => epoch + 1);
    setNotice(`${conversation.title} 대화를 여는 중…`);
    setError(undefined);
    write("\u001B[2J\u001B[3J\u001B[H");
    void connector
      .openConversation(conversation.id)
      .then(() => {
        transcriptConversation.current = undefined;
        emittedMessageIds.current.clear();
        setWorkspaceCleared(false);
        setMessagesHidden(false);
        setConversationOpenEpoch((epoch) => epoch + 1);
      })
      .catch((error) => {
        setMessagesHidden(false);
        showError(error);
      });
  };

  const loadOlderMessages = (): void => {
    if (loadingOlder || !snapshot.activeConversationId || workspaceCleared) return;
    olderLoadInProgress.current = true;
    setLoadingOlder(true);
    setNotice("이전 메시지를 불러오는 중…");
    void connector
      .loadOlderMessages()
      .then((added) => {
        if (added > 0) {
          // Prepending does not change the old viewport's distance from the bottom.
          // Advance by one item so the user sees the next older message, not the
          // first item of the entire newly loaded batch.
          setMessageOffset((offset) => offset + 1);
          setNotice(`이전 메시지 ${added}개를 불러왔습니다.`);
        } else {
          setNotice("더 이전 메시지가 없습니다.");
        }
      })
      .catch(showError)
      .finally(() => {
        olderLoadInProgress.current = false;
        setLoadingOlder(false);
      });
  };

  useInput((value, key) => {
    if (key.ctrl && value === "c") {
      leaveHistoryScreenImmediately();
      exit();
      return;
    }
    if (key.escape) {
      if (commandMode) {
        setInput("");
        setNotice("명령 palette를 닫았습니다.");
      } else if (viewMode === "effort") {
        setViewMode("model");
        setNotice(undefined);
      } else if (viewMode === "history") {
        setViewMode("chat");
        setNotice("채팅으로 돌아왔습니다.");
      } else if (viewMode !== "chat") {
        setViewMode("chat");
        setNotice("채팅으로 돌아왔습니다.");
      } else {
        exit();
      }
      return;
    }
    if (commandMode) {
      if (key.upArrow) {
        setCommandIndex((index) => wrapSelectionIndex(index, -1, commandMatches.length));
      }
      if (key.downArrow) {
        setCommandIndex((index) => wrapSelectionIndex(index, 1, commandMatches.length));
      }
      if (key.tab) {
        const command = commandMatches[commandIndex];
        if (command) setInput(`/${command.name} `);
      }
      return;
    }
    if (viewMode === "theme" && key.upArrow) {
      setThemeIndex((index) => wrapSelectionIndex(index, -1, UI_THEMES.length));
      return;
    }
    if (viewMode === "theme" && key.downArrow) {
      setThemeIndex((index) => wrapSelectionIndex(index, 1, UI_THEMES.length));
      return;
    }
    if (viewMode === "theme" && key.return && !input) {
      const selectedTheme = UI_THEMES[themeIndex];
      if (selectedTheme) {
        applyTheme(selectedTheme);
        setViewMode("chat");
      }
      return;
    }
    if (viewMode === "model" && key.upArrow) {
      setModelIndex((index) => wrapSelectionIndex(index, -1, DISPLAY_MODELS.length));
      return;
    }
    if (viewMode === "model" && key.downArrow) {
      setModelIndex((index) => wrapSelectionIndex(index, 1, DISPLAY_MODELS.length));
      return;
    }
    if (viewMode === "model" && key.return && !input) {
      const selectedModel = DISPLAY_MODELS[modelIndex];
      if (selectedModel) chooseModel(selectedModel);
      return;
    }
    if (viewMode === "effort" && key.upArrow) {
      setEffortIndex((index) => wrapSelectionIndex(index, -1, effortModel.efforts?.length ?? 0));
      return;
    }
    if (viewMode === "effort" && key.downArrow) {
      setEffortIndex((index) => wrapSelectionIndex(index, 1, effortModel.efforts?.length ?? 0));
      return;
    }
    if (viewMode === "effort" && key.return && !input) {
      const selectedEffort = effortModel.efforts?.[effortIndex];
      if (selectedEffort) {
        applyModel(effortModel, selectedEffort);
        setViewMode("chat");
      }
      return;
    }
    if (viewMode === "conversations" && key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
    }
    if (viewMode === "conversations" && key.downArrow) {
      setSelectedIndex((index) => Math.min(Math.max(0, conversations.length - 1), index + 1));
    }
    if (viewMode === "conversations" && key.return && !input) {
      const conversation = conversations[selectedIndex];
      if (conversation) openConversation(conversation);
    }
    if (viewMode === "chat" && !input && (key.upArrow || key.pageUp)) {
      if (!snapshot.activeConversationId || workspaceCleared) {
        setNotice("먼저 대화를 선택하세요.");
        return;
      }
      enterHistoryScreen();
      setMessageOffset(key.pageUp ? messageWindow.maxOffset : 0);
      setNotice("과거 대화 내역입니다.");
      if (key.pageUp) loadOlderMessages();
      return;
    }
    if (viewMode === "history" && (key.upArrow || key.pageUp)) {
      if (messageOffset < messageWindow.maxOffset) {
        const nextOffset = key.pageUp
          ? messageWindow.maxOffset
          : Math.min(messageWindow.maxOffset, messageOffset + 1);
        setMessageOffset(nextOffset);
        if (nextOffset === messageWindow.maxOffset) loadOlderMessages();
      } else {
        loadOlderMessages();
      }
      return;
    }
    if (viewMode === "history" && (key.downArrow || key.pageDown)) {
      setMessageOffset((offset) => (key.pageDown ? 0 : Math.max(0, offset - 1)));
      return;
    }
  });

  const activeConversation = useMemo(
    () =>
      workspaceCleared
        ? undefined
        : snapshot.conversations.find((item) => item.id === snapshot.activeConversationId),
    [snapshot, workspaceCleared],
  );
  const activeTitle = activeConversation?.title ?? "대화를 선택하세요";
  const activeProvider = activeConversation?.provider ?? "instagram";
  const activePath =
    activeTitle === "대화를 선택하세요"
      ? "~/conversations"
      : `~/${activeProvider}/${toPathSegment(activeTitle)}`;
  const footerRows = Math.max(
    1,
    Math.ceil(
      stringWidth(`${displayModelLabel} · ${activePath}`) /
        Math.max(1, terminalSize.columns - 4),
    ),
  );
  const commandPanelRows = commandMode
    ? 3 + Math.max(1, commandWindow.items.length)
    : 0;
  const chatChromeRows = 4 + footerRows + commandPanelRows + (error ? 1 : 0);
  const chatSpacerHeight = Math.max(
    0,
    terminalSize.rows -
      (commandMode && commandAlternateScreen.current ? 0 : transcriptRows) -
      chatChromeRows,
  );

  const handleInputChange = (nextInput: string): void => {
    const nextCommandMode = nextInput.startsWith("/") && !nextInput.startsWith("//");
    if (nextCommandMode && !commandAlternateScreen.current && viewMode === "chat") {
      const nextMatches = filterSlashCommands(nextInput);
      const nextPanelRows = 3 + Math.max(1, Math.min(commandWindowSize, nextMatches.length));
      const nextChromeRows = 4 + footerRows + nextPanelRows + (error ? 1 : 0);
      if (transcriptRows + nextChromeRows > terminalSize.rows) {
        // Once Static content has filled the viewport, opening an inline palette
        // scrolls the primary buffer. It cannot be pulled back when the palette
        // shrinks, which leaves blank rows below the footer. Use a temporary
        // screen for only that overflowing palette and restore the chat exactly.
        stdout.write("\u001B[?1049h\u001B[2J\u001B[H");
        commandAlternateScreen.current = true;
      }
    }
    setInput(nextInput);
  };

  useEffect(() => {
    if (viewMode === "history" || commandAlternateScreen.current) return;
    const conversationId = snapshot.activeConversationId;
    if (!conversationId || messagesHidden || workspaceCleared) return;
    const additions: TranscriptItem[] = [];
    if (transcriptConversation.current !== conversationId) {
      transcriptConversation.current = conversationId;
      emittedMessageIds.current.clear();
    }
    for (const message of snapshot.messages) {
      if (emittedMessageIds.current.has(message.id)) continue;
      emittedMessageIds.current.add(message.id);
      additions.push({ id: `message:${conversationId}:${message.id}`, kind: "message", message });
    }
    if (additions.length > 0) setTranscript((items) => [...items, ...additions]);
  }, [
    conversationOpenEpoch,
    commandMode,
    messagesHidden,
    snapshot.activeConversationId,
    snapshot.messages,
    viewMode,
    workspaceCleared,
  ]);

  const executeCommand = async (command: SlashCommand, args: string[]): Promise<void> => {
    switch (command.name) {
      case "help":
        setNotice(
          SLASH_COMMANDS.map((item) => item.usage).join(" · ") +
            " · //문자 = /로 시작하는 메시지",
        );
        return;
      case "open": {
        const query = args.join(" ").trim().toLowerCase();
        if (!query) {
          setNotice("사용법: /open <대화방 이름>");
          return;
        }
        const matches = snapshot.conversations.filter((conversation) =>
          conversation.title.toLowerCase().includes(query),
        );
        if (matches.length === 1) {
          openConversation(matches[0]!);
        } else if (matches.length === 0) {
          setNotice(`“${args.join(" ")}”에 맞는 대화방이 없습니다.`);
        } else {
          setNotice(`후보: ${matches.slice(0, 5).map((item) => item.title).join(", ")}`);
        }
        return;
      }
      case "conversations":
        setViewMode("conversations");
        setNotice("대화방 목록입니다. ↑↓로 선택하고 Enter로 여세요.");
        return;
      case "unread":
        setConversationFilter("unread");
        setViewMode("conversations");
        setSelectedIndex(0);
        setNotice("안 읽은 대화만 표시합니다.");
        return;
      case "all":
        setConversationFilter("all");
        setViewMode("conversations");
        setSelectedIndex(0);
        setNotice("모든 대화를 표시합니다.");
        return;
      case "connectors":
        setViewMode("connectors");
        setNotice(undefined);
        return;
      case "history":
        if (!snapshot.activeConversationId || workspaceCleared) {
          setNotice("먼저 대화를 선택하세요.");
          return;
        }
        setMessageOffset(0);
        enterHistoryScreen();
        setNotice("과거 대화 내역입니다.");
        return;
      case "model": {
        const requested = args.join(" ").trim();
        if (requested) {
          const selectedModel = findDisplayModel(requested);
          if (!selectedModel) {
            setNotice(`모델을 찾을 수 없습니다: ${requested}`);
            return;
          }
          const requestedEffort = effortFromModelValue(requested);
          if (requestedEffort && selectedModel.efforts?.includes(requestedEffort)) {
            applyModel(selectedModel, requestedEffort);
            setViewMode("chat");
          } else {
            chooseModel(selectedModel);
          }
          return;
        }
        setModelIndex(Math.max(0, DISPLAY_MODELS.findIndex((item) => item.id === modelId)));
        setViewMode("model");
        setNotice(undefined);
        return;
      }
      case "theme": {
        const requested = args.join(" ").trim();
        if (requested) {
          const selectedTheme = findTheme(requested);
          if (!selectedTheme) {
            setNotice(`테마를 찾을 수 없습니다: ${requested}`);
            return;
          }
          applyTheme(selectedTheme);
          return;
        }
        setThemeIndex(Math.max(0, UI_THEMES.findIndex((item) => item.id === themeId)));
        setViewMode("theme");
        setNotice(undefined);
        return;
      }
      case "refresh":
        setNotice("connector 화면을 다시 읽는 중…");
        await connector.refresh();
        setNotice("새로고침했습니다.");
        return;
      case "clear":
        // Static output has already been committed to terminal scrollback. Reset both
        // Ink's static buffer and the terminal's visible screen/scrollback buffer.
        emittedMessageIds.current.clear();
        transcriptConversation.current = undefined;
        leaveHistoryScreenImmediately();
        setTranscript([]);
        setTranscriptEpoch((epoch) => epoch + 1);
        setMessagesHidden(false);
        setWorkspaceCleared(true);
        setMessageOffset(0);
        setViewMode("chat");
        setNotice(undefined);
        write("\u001B[2J\u001B[3J\u001B[H");
        return;
      case "exit":
        leaveHistoryScreenImmediately();
        exit();
        return;
    }
  };

  const submit = (value: string): void => {
    const parsed = parseSubmission(value);
    if (parsed.kind === "empty") return;
    setInput("");
    setError(undefined);

    if (parsed.kind === "command") {
      const command = findSlashCommand(parsed.name) ?? commandMatches[commandIndex];
      if (commandAlternateScreen.current) {
        pendingAfterCommandScreen.current = command
          ? () => void executeCommand(command, parsed.args).catch(showError)
          : () => setNotice(`알 수 없는 명령입니다: /${parsed.name}. /help로 명령을 확인하세요.`);
        return;
      }
      if (!command) {
        setNotice(`알 수 없는 명령입니다: /${parsed.name}. /help로 명령을 확인하세요.`);
        return;
      }
      void executeCommand(command, parsed.args).catch(showError);
      return;
    }

    if (!snapshot.activeConversationId || workspaceCleared) {
      setNotice("먼저 대화를 선택하세요.");
      return;
    }
    setMessagesHidden(false);
    setMessageOffset(0);
    leaveHistoryScreenImmediately();
    setViewMode("chat");
    void connector.sendMessage(parsed.text).catch(showError);
  };

  return (
    <>
      <Static key={transcriptEpoch} items={transcript}>
        {(item) => {
          if (item.kind === "signature") {
            return item.full ? (
              <Box key={item.id} flexDirection="column" marginTop={1} paddingX={1}>
                <Text>
                  <Text color={theme.accent}>{" /\\_/\\  "}</Text>
                  <Text bold>  oh-my-dm</Text>
                  <Text color={theme.muted}> v{APP_VERSION}</Text>
                </Text>
                <Text>
                  <Text color={theme.accent}>{"( o.o ) "}</Text>
                  <Text color={theme.muted}>  terminal workspace</Text>
                </Text>
                <Text>
                  <Text color={theme.accent}>{" > ^ <  "}</Text>
                  <Text color={theme.muted}>  local · ephemeral</Text>
                </Text>
              </Box>
            ) : (
              <Box key={item.id} marginTop={1} paddingX={1}>
                <Text bold color={theme.accent}>oh-my-dm</Text>
                <Text color={theme.muted}> v{APP_VERSION}</Text>
              </Box>
            );
          }
          const messageText = item.message.text.replaceAll("\n", " ");
          return item.message.sender === "나" ? (
            <Box key={item.id} flexDirection="column" marginTop={1} paddingX={1}>
              {formatUserMessageLines(messageText, messageContentWidth).map((line, index) => (
                <Text
                  key={`${item.id}:${index}`}
                  color={theme.userForeground}
                  backgroundColor={theme.userBackground}
                >
                  {line}
                </Text>
              ))}
            </Box>
          ) : (
            <Box key={item.id} marginTop={1} paddingX={1}>
              <Text wrap="wrap">
                <Text bold>{item.message.sender}: </Text>
                {messageText}
              </Text>
            </Box>
          );
        }}
      </Static>

      <Box flexDirection="column" paddingX={1}>

      <Box
        marginTop={viewMode === "chat" ? 0 : 1}
        height={viewMode === "chat" ? chatSpacerHeight : mainHeight}
      >
        {viewMode === "history" ? (
          <Box flexGrow={1} flexDirection="column" borderStyle="single" paddingX={1}>
            <Text>
              <Text color={theme.muted}>{displayModelLabel} · </Text>
              <Text bold color={theme.path}>{activePath}</Text>
              <Text color={theme.muted}> · history</Text>
            </Text>
            {messageWindow.items.length === 0 ? (
              <Text color={theme.muted}>표시할 메시지가 없습니다.</Text>
            ) : (
              messageWindow.items.map((message) => {
                const messageText = message.text.replaceAll("\n", " ");
                if (message.sender === "나") {
                  const lines = clipTerminalLines(
                    formatUserMessageLines(messageText, conversationContentWidth),
                    visibleMessageCount,
                    conversationContentWidth,
                    true,
                  );
                  return (
                    <Box key={message.id} flexDirection="column">
                      {lines.map((line, index) => (
                        <Text
                          key={`${message.id}:${index}`}
                          color={theme.userForeground}
                          backgroundColor={theme.userBackground}
                        >
                          {line}
                        </Text>
                      ))}
                    </Box>
                  );
                }
                const lines = clipTerminalLines(
                  wrapTerminalLines(`${message.sender}: ${messageText}`, conversationContentWidth),
                  visibleMessageCount,
                  conversationContentWidth,
                );
                return (
                  <Box key={message.id} flexDirection="column">
                    {lines.map((line, index) => (
                      <Text key={`${message.id}:${index}`}>{line}</Text>
                    ))}
                  </Box>
                );
              })
            )}
            <Box>
              <Text color={theme.muted}>
                {loadingOlder
                  ? "이전 메시지를 불러오는 중…"
                  : "↑/PageUp: 이전 · ↓/PageDown: 최근 · Esc: 돌아가기"}
              </Text>
            </Box>
          </Box>
        ) : viewMode === "conversations" ? (
          <Box flexGrow={1} flexDirection="column" borderStyle="single" paddingX={1}>
            <Text bold color={theme.path}>~/conversations · {conversationFilter}</Text>
            {conversations.length === 0 ? (
              <Text color={theme.muted}>
                {conversationFilter === "unread"
                  ? "안 읽은 대화가 없습니다."
                  : "대화 목록을 기다리는 중…"}
              </Text>
            ) : (
              conversationWindow.items.map((conversation, index) => {
                const absoluteIndex = conversationWindow.start + index;
                const selected = absoluteIndex === selectedIndex;
                const prefix = `${selected ? ">" : " "} ${conversation.unread ? "●" : " "} `;
                const isKakaoTalk = conversation.provider === "kakaotalk";
                const providerMark = isKakaoTalk ? "K" : "I";
                const providerColor = isKakaoTalk
                  ? CONNECTOR_COLORS.kakaotalk
                  : CONNECTOR_COLORS.instagram;
                const title = padToWidth(
                  conversation.title,
                  Math.max(1, conversationTitleWidth - 2),
                );
                const preview = truncateToWidth(
                  conversation.preview?.replaceAll("\n", " ") ?? "",
                  conversationPreviewWidth,
                );
                return (
                  <Box key={conversation.id}>
                    <Text color={selected ? theme.accent : undefined} bold={selected}>
                      {prefix}<Text color={providerColor}>{providerMark}</Text> {title}
                      {showConversationPreview && preview && (
                        <Text color={selected ? theme.accent : theme.muted} bold={false}> {preview}</Text>
                      )}
                    </Text>
                  </Box>
                );
              })
            )}
          </Box>
        ) : viewMode === "connectors" ? (
          <Box flexGrow={1} flexDirection="column" borderStyle="single" paddingX={2}>
            <Text bold>Manage connectors</Text>
            <Text color={theme.muted}>{snapshot.connectors?.length ?? 1} connectors</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.muted}>Chat connectors</Text>
              {(snapshot.connectors ?? [
                { id: "instagram", label: "Instagram", state: snapshot.state, detail: snapshot.detail },
              ]).map((connectorStatus, index) => (
                <Box key={connectorStatus.id} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
                  <Text>
                    <Text color={theme.accent}>❯ </Text>
                    <Text bold>{connectorStatus.id}</Text>
                    <Text> · </Text>
                    <Text color={serviceStateColor(connectorStatus.state, theme)}>
                      {serviceStateIcon(connectorStatus.state)} {connectorStatus.state}
                    </Text>
                  </Text>
                  <Box marginLeft={3} flexDirection="column">
                    <Text color={theme.muted}>
                      source      {connectorStatus.id === "instagram" ? "instagram.com/direct · live DOM + WebSocket" : "KakaoTalk for macOS · persistent native bridge"}
                    </Text>
                    <Text color={theme.muted}>storage     session only · messages are not persisted</Text>
                    {connectorStatus.detail && <Text color={theme.muted}>detail      {connectorStatus.detail}</Text>}
                  </Box>
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text color={theme.muted}>※ /refresh로 connector 상태를 다시 확인할 수 있습니다.</Text>
            </Box>
          </Box>
        ) : viewMode === "model" ? (
          <Box flexGrow={1} flexDirection="column" borderStyle="single" paddingX={2}>
            <Text bold>
              Choose a model <Text color={theme.muted}>· {DISPLAY_MODELS.length} models</Text>
            </Text>
            <Box flexDirection="column">
              {modelWindow.items.map((item, index) => {
                const absoluteIndex = modelWindow.start + index;
                const selected = absoluteIndex === modelIndex;
                return (
                  <Text key={item.id} color={selected ? theme.accent : undefined}>
                    {selected ? "❯" : " "} {item.label.padEnd(24)} · {item.source}
                    {item.id === modelId ? " · active" : ""}
                  </Text>
                );
              })}
            </Box>
            <Box>
              <Text color={theme.muted}>↑/↓ to navigate · Enter to apply · Esc to cancel</Text>
            </Box>
          </Box>
        ) : viewMode === "effort" ? (
          <Box flexGrow={1} flexDirection="column" borderStyle="single" paddingX={2}>
            <Text bold>
              Choose reasoning effort <Text color={theme.muted}>· {effortModel.label}</Text>
            </Text>
            <Box flexDirection="column">
              {effortWindow.items.map((effort, index) => {
                const absoluteIndex = effortWindow.start + index;
                return (
                  <Text key={effort} color={absoluteIndex === effortIndex ? theme.accent : undefined}>
                    {absoluteIndex === effortIndex ? "❯" : " "} {effort}
                    {effortModel.id === modelId && effort === modelEffort ? " · active" : ""}
                  </Text>
                );
              })}
            </Box>
            <Box>
              <Text color={theme.muted}>↑/↓ to navigate · Enter to apply · Esc to models</Text>
            </Box>
          </Box>
        ) : viewMode === "theme" ? (
          <Box flexGrow={1} flexDirection="column" borderStyle="single" paddingX={2}>
            <Text bold>Choose a theme</Text>
            <Text color={theme.muted}>{UI_THEMES.length} themes</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.muted}>UI themes</Text>
              {UI_THEMES.map((item, index) => (
                <Text key={item.id} color={index === themeIndex ? item.accent : undefined}>
                  {index === themeIndex ? "❯" : " "} {item.id.padEnd(12)} · {item.source}
                  {item.id === themeId ? " · active" : ""}
                </Text>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text color={theme.muted}>↑/↓ to navigate · Enter to apply · Esc to cancel</Text>
            </Box>
          </Box>
        ) : null}
      </Box>

      {commandMode && (
        <Box flexDirection="column" borderStyle="single" borderColor={theme.command} paddingX={1}>
          <Text bold color={theme.command}>
            commands
            {commandMatches.length > commandWindowSize
              ? ` [${commandWindow.start + 1}-${commandWindow.end}/${commandMatches.length}]`
              : ""}
          </Text>
          {commandMatches.length === 0 ? (
            <Text color={theme.muted}>일치하는 명령이 없습니다.</Text>
          ) : (
            <>
              {commandWindow.items.map((command, index) => {
                const absoluteIndex = commandWindow.start + index;
                return (
                  <Text
                    key={command.name}
                    color={absoluteIndex === commandIndex ? theme.command : undefined}
                  >
                    {absoluteIndex === commandIndex ? ">" : " "} /{command.name.padEnd(13)}{" "}
                    {command.description}
                  </Text>
                );
              })}
            </>
          )}
        </Box>
      )}

      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={commandMode ? theme.command : theme.border}
        paddingX={1}
      >
        <Text color={theme.prompt} bold>&gt; </Text>
        <Box flexGrow={1} flexShrink={1} minWidth={1}>
          <ImeTextInput
            value={input}
            onChange={handleInputChange}
            onSubmit={submit}
            placeholder="Type your message..."
            cursorPosition={
              viewMode === "chat"
                ? { x: 5, y: chatSpacerHeight + commandPanelRows + 2 }
                : undefined
            }
          />
        </Box>
        {showComposerHints && (
          <Text color={theme.muted}>
            ↩: {viewMode === "conversations" ? "Open" : "Send"} · /: Commands · Esc: {viewMode === "chat" ? "Exit" : "Back"}
          </Text>
        )}
      </Box>
      {viewMode === "chat" && (
        <Text>
          {"  "}
          <Text color={theme.muted}>{displayModelLabel} · </Text>
          <Text color={theme.path}>{activePath}</Text>
        </Text>
      )}
      {error && <Text color={theme.danger}>error: {error}</Text>}
      </Box>
    </>
  );
}

function toPathSegment(value: string): string {
  return value.replaceAll("/", "／").replaceAll("\\", "＼").trim();
}

function wrapTerminalLines(value: string, width: number): string[] {
  return wrapAnsi(value, Math.max(1, width), {
    hard: true,
    wordWrap: false,
    trim: false,
  }).split("\n");
}

function clipTerminalLines(
  lines: string[],
  maxRows: number,
  width: number,
  pad: boolean = false,
): string[] {
  const limit = Math.max(1, maxRows);
  if (lines.length <= limit) return lines;
  const clipped = lines.slice(0, limit);
  const lastIndex = clipped.length - 1;
  const lastLine = truncateToWidth(clipped[lastIndex]!.trimEnd(), Math.max(1, width - 1));
  const ellipsized = `${lastLine}…`;
  clipped[lastIndex] = pad ? padToWidth(ellipsized, width) : ellipsized;
  return clipped;
}

function serviceStateIcon(state: ChatSnapshot["state"]): string {
  if (state === "connected") return "✔";
  if (state === "error" || state === "disconnected") return "✘";
  return "…";
}

function serviceStateColor(state: ChatSnapshot["state"], theme: UiTheme): string {
  if (state === "connected") return theme.success;
  if (state === "error" || state === "disconnected") return theme.danger;
  return theme.warning;
}

function useTerminalSize(stdout: NodeJS.WriteStream): { rows: number; columns: number } {
  const readSize = (): { rows: number; columns: number } => ({
    rows: stdout.rows || 32,
    columns: stdout.columns || 80,
  });
  const [size, setSize] = useState(readSize);

  useEffect(() => {
    const update = (): void => setSize(readSize());
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  return size;
}
