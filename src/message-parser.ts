import type { CardConfig, ChatMessage, LogbookEntry, MessageGroup, RenderItem } from './types';
import { CHANNEL_PREFIX_REGEX, MENTION_BRACKET_REGEX, MENTION_WORD_REGEX } from './constants';

/**
 * Generate a simple deterministic ID for a message.
 */
function generateId(timestamp: string, sender: string, text: string): string {
  const raw = `${timestamp}|${sender}|${text}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extract @mentions from message text.
 * Supports @[Name With Spaces] and @SingleWord patterns.
 */
export function extractMentions(text: string): string[] {
  const mentions: string[] = [];
  const seen = new Set<string>();

  // @[Name] pattern (higher priority — captures names with spaces/emoji)
  let match: RegExpExecArray | null;
  const bracketRegex = new RegExp(MENTION_BRACKET_REGEX.source, 'g');
  while ((match = bracketRegex.exec(text)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      mentions.push(name);
    }
  }

  // @Word pattern (only add if not already captured by bracket pattern)
  const wordRegex = new RegExp(MENTION_WORD_REGEX.source, 'g');
  while ((match = wordRegex.exec(text)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      mentions.push(name);
    }
  }

  return mentions;
}

/**
 * Parse a single logbook entry into a ChatMessage, or return null if it should be discarded.
 */
export function parseLogbookEntry(
  entry: LogbookEntry,
  config: Pick<CardConfig, 'node_name' | 'domain_filter'>,
): ChatMessage | null {
  // Discard state change entries (have `state` field without `message`)
  if (entry.state !== undefined && !entry.message) {
    return null;
  }

  // Must have a message field
  if (!entry.message) {
    return null;
  }

  // Filter by domain if configured
  if (config.domain_filter && entry.domain && entry.domain !== config.domain_filter) {
    return null;
  }

  const raw = entry.message;
  const timestamp = new Date(entry.when);

  // Step 1: Strip channel prefix (e.g., "<Public> ", "<#test> ")
  const stripped = raw.replace(CHANNEL_PREFIX_REGEX, '');

  // Step 2: Determine sender and text.
  //
  // The HA logbook API provides entry.name (the sender) and entry.message
  // (the formatted text). For MeshCore, entry.name is ALWAYS the real sender.
  // The message text may or may not have a "sender: " prefix embedded.
  //
  // IMPORTANT: We must NOT blindly split on ": " because the message text
  // itself may contain ": " (e.g., "@Smky11: 👋" is a mention, not a sender).
  // When entry.name is present, always trust it as the sender.
  let sender: string;
  let text: string;

  if (entry.name) {
    // Prefer entry.name as the sender (most reliable source)
    sender = entry.name;

    // Strip the "sender: " prefix from the message text if present,
    // so we don't show it redundantly (e.g., "MnE1: hello" → "hello")
    const senderPrefix = sender + ': ';
    if (stripped.startsWith(senderPrefix)) {
      text = stripped.substring(senderPrefix.length);
    } else {
      text = stripped;
    }
  } else {
    // No entry.name — fall back to splitting on ": " in the message
    const separatorIndex = stripped.indexOf(': ');
    if (separatorIndex !== -1) {
      sender = stripped.substring(0, separatorIndex);
      text = stripped.substring(separatorIndex + 2);
    } else {
      // No sender available anywhere — treat as system message
      return {
        id: generateId(entry.when, '', stripped),
        sender: '',
        text: stripped,
        timestamp,
        isOutgoing: false,
        isSystem: true,
        raw,
        mentions: extractMentions(stripped),
      };
    }
  }

  // Step 3: Determine outgoing status
  const isOutgoing = sender === config.node_name;

  // Step 4: Extract mentions
  const mentions = extractMentions(text);

  return {
    id: generateId(entry.when, sender, text),
    sender,
    text,
    timestamp,
    isOutgoing,
    isSystem: false,
    raw,
    mentions,
  };
}

/**
 * Parse an array of logbook entries into ChatMessages, filtering out non-messages.
 */
export function parseLogbookEntries(
  entries: LogbookEntry[],
  config: Pick<CardConfig, 'node_name' | 'domain_filter'>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < entries.length; i++) {
    const msg = parseLogbookEntry(entries[i], config);
    if (msg) {
      messages.push(msg);
    }
  }
  return messages;
}

/**
 * Group consecutive messages from the same sender within a time window.
 */
export function groupMessages(messages: ChatMessage[], timeoutSeconds: number): MessageGroup[] {
  if (messages.length === 0) return [];

  const groups: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;

  for (const msg of messages) {
    const shouldStartNewGroup =
      !currentGroup ||
      msg.isSystem ||
      currentGroup.isSystem ||
      msg.sender !== currentGroup.sender ||
      (msg.timestamp.getTime() - currentGroup.endTime.getTime()) / 1000 > timeoutSeconds;

    if (shouldStartNewGroup) {
      currentGroup = {
        sender: msg.sender,
        isOutgoing: msg.isOutgoing,
        isSystem: msg.isSystem,
        messages: [msg],
        startTime: msg.timestamp,
        endTime: msg.timestamp,
      };
      groups.push(currentGroup);
    } else {
      currentGroup!.messages.push(msg);
      currentGroup!.endTime = msg.timestamp;
    }
  }

  return groups;
}

/**
 * Check if two dates are on different calendar days.
 */
function isDifferentDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}

/**
 * Format a date for the date separator label.
 */
export function formatDateSeparator(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Build render items: message groups interleaved with date separators.
 */
export function buildRenderItems(
  messages: ChatMessage[],
  config: Pick<CardConfig, 'group_messages' | 'group_timeout' | 'show_date_separators'>,
): RenderItem[] {
  const timeoutSeconds = config.group_timeout ?? 300;
  const groups =
    config.group_messages !== false
      ? groupMessages(messages, timeoutSeconds)
      : messages.map(
          (msg): MessageGroup => ({
            sender: msg.sender,
            isOutgoing: msg.isOutgoing,
            isSystem: msg.isSystem,
            messages: [msg],
            startTime: msg.timestamp,
            endTime: msg.timestamp,
          }),
        );

  if (groups.length === 0) return [];

  const items: RenderItem[] = [];
  let lastDate: Date | null = null;

  for (const group of groups) {
    const groupDate = group.startTime;

    // Insert date separator if day changed
    if (
      config.show_date_separators !== false &&
      (!lastDate || isDifferentDay(lastDate, groupDate))
    ) {
      items.push({
        type: 'date-separator',
        date: groupDate,
        label: formatDateSeparator(groupDate),
      });
    }

    items.push({ type: 'group', group });
    lastDate = groupDate;
  }

  return items;
}

/**
 * Format a relative timestamp (e.g., "2m ago", "1h ago", "Yesterday").
 */
export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Format a timestamp according to the configured format.
 */
export function formatTimestamp(date: Date, format: 'relative' | 'time' | 'datetime'): string {
  switch (format) {
    case 'relative':
      return formatRelativeTime(date);
    case 'time':
      return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    case 'datetime':
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    default:
      return formatRelativeTime(date);
  }
}
