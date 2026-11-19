export interface ToolResult {
  name: string;
  result: any;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolResults?: ToolResult[];
  /** Tools that failed while this reply was being written (the stream's tool-error parts). */
  toolErrors?: string[];
  /** When the reply finished, for "from your shop's data · 3:42". Absent while streaming. */
  at?: number;
}

/**
 * A line from the system, not from the assistant: why a reply did not arrive
 * and what to do about it.
 */
export interface ChatNotice {
  kind: 'error' | 'timeout' | 'cancelled' | 'disabled' | 'limit' | 'not_configured';
  message: string;
  canRetry: boolean;
}

/** What the assistant is doing right now; `tool` is null before the first tool is called. */
export interface ChatProgress {
  tool: string | null;
}
