export type ConnectionState =
  | "starting"
  | "login-required"
  | "connected"
  | "disconnected"
  | "error";

export interface Conversation {
  id: string;
  provider?: string;
  title: string;
  href: string;
  preview?: string;
  unread: boolean;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  text: string;
  sender: string;
  timestamp?: string;
}

export interface ChatSnapshot {
  state: ConnectionState;
  conversations: Conversation[];
  activeConversationId?: string;
  messages: ChatMessage[];
  detail?: string;
  connectors?: ConnectorStatus[];
}

export interface ConnectorStatus {
  id: string;
  label: string;
  state: ConnectionState;
  detail?: string;
}

export interface ConnectorEvents {
  snapshot: [snapshot: ChatSnapshot];
  error: [error: Error];
}

export interface ChatConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSnapshot(): ChatSnapshot;
  refresh(): Promise<void>;
  loadMoreConversations(provider?: string): Promise<number>;
  loadOlderMessages(): Promise<number>;
  openConversation(id: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
  on<K extends keyof ConnectorEvents>(
    event: K,
    listener: (...args: ConnectorEvents[K]) => void,
  ): this;
  off<K extends keyof ConnectorEvents>(
    event: K,
    listener: (...args: ConnectorEvents[K]) => void,
  ): this;
}
