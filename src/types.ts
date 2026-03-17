/**
 * Home Assistant types (minimal subset needed by the card)
 */
export interface HomeAssistant {
  states: Record<string, HassEntity>;
  callApi: <T>(method: string, path: string) => Promise<T>;
  callService: (domain: string, service: string, data?: Record<string, unknown>) => Promise<void>;
  callWS: <T>(msg: Record<string, unknown>) => Promise<T>;
  connection: {
    subscribeEvents: (
      callback: (event: HassEvent) => void,
      eventType: string,
    ) => Promise<() => void>;
  };
  themes: {
    darkMode: boolean;
  };
  language: string;
  locale: Record<string, unknown>;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

export interface HassEvent {
  event_type: string;
  data: {
    entity_id?: string;
    new_state?: HassEntity;
    old_state?: HassEntity;
    [key: string]: unknown;
  };
  time_fired: string;
}

/**
 * Raw logbook entry from HA REST API /api/logbook/{timestamp}
 */
export interface LogbookEntry {
  /** ISO timestamp of the entry */
  when: string;
  /** Entity friendly name (present on state change entries) */
  name?: string;
  /** Formatted logbook message (present on message entries) */
  message?: string;
  /** Entity ID */
  entity_id?: string;
  /** Domain (e.g., "meshcore") */
  domain?: string;
  /** Present for state changes — filter these out */
  state?: string;
  /** Icon */
  icon?: string;
}

/**
 * Parsed chat message
 */
export interface ChatMessage {
  /** Unique ID (hash of timestamp + sender + text) */
  id: string;
  /** Parsed sender name */
  sender: string;
  /** Message content (prefix stripped) */
  text: string;
  /** Message timestamp */
  timestamp: Date;
  /** true if sender matches node_name */
  isOutgoing: boolean;
  /** true if unparseable (no sender:message pattern) */
  isSystem: boolean;
  /** Original logbook message text */
  raw: string;
  /** Extracted @[Name] and @Name mentions */
  mentions: string[];
}

/**
 * Group of consecutive messages from the same sender
 */
export interface MessageGroup {
  sender: string;
  isOutgoing: boolean;
  isSystem: boolean;
  messages: ChatMessage[];
  startTime: Date;
  endTime: Date;
}

/**
 * Render item — either a message group or a date separator
 */
export type RenderItem =
  | { type: 'group'; group: MessageGroup }
  | { type: 'date-separator'; date: Date; label: string };

/**
 * localStorage cache entry
 */
export interface CacheEntry {
  entityId: string;
  messages: ChatMessage[];
  lastFetched: number;
  oldestMessage: number;
  newestMessage: number;
  version: number;
}

/**
 * Named preset configuration for specific integrations
 */
export interface PresetConfig {
  /** Preset display name */
  name: string;
  /** Default entity selection mode */
  mode: 'external' | 'builtin' | 'static';
  /** Default entities for external mode */
  recipient_type_entity?: string;
  channel_entity?: string;
  contact_entity?: string;
  /** Entity pattern templates */
  channel_entity_pattern?: string;
  contact_entity_pattern?: string;
  /** Default send configuration */
  send_mode?: 'service' | 'entity';
  send_service?: string;
  send_text_entity?: string;
  send_trigger_entity?: string;
  /** Domain filter for logbook entries */
  domain_filter?: string;
}

/**
 * Card configuration
 */
export interface CardConfig {
  type: string;

  // === Identity ===
  /** Required. Your node name for outgoing detection */
  node_name: string;
  /** Node prefix for entity pattern matching */
  node_prefix?: string;
  /** Named preset (e.g., "meshcore") */
  preset?: string;

  // === Entity Selection Mode ===
  /** "external" | "builtin" | "static" (default: external) */
  mode?: 'external' | 'builtin' | 'static';

  // --- External mode entities ---
  recipient_type_entity?: string;
  channel_entity?: string;
  contact_entity?: string;

  // --- Entity patterns ---
  channel_entity_pattern?: string;
  contact_entity_pattern?: string;

  // --- Static mode ---
  entity?: string;

  // --- Domain filter ---
  /** Filter logbook entries to this domain (e.g., "meshcore") */
  domain_filter?: string;

  // === Display ===
  /** Hours of history to fetch (default: 48) */
  hours_to_show?: number;
  /** Initial hours to load on first render for fast first paint (default: 1).
   *  Expansion: initial_hours → 3x → 6x, then lazy-load on scroll. */
  initial_hours?: number;
  /** Max messages to display (default: 500) */
  max_messages?: number;
  /** Show search/filter bar (default: false) */
  show_search?: boolean;
  /** Show date dividers (default: true) */
  show_date_separators?: boolean;
  /** Group consecutive same-sender messages (default: true) */
  group_messages?: boolean;
  /** Seconds before same-sender group breaks (default: 300) */
  group_timeout?: number;
  /** "relative" | "time" | "datetime" (default: relative) */
  timestamp_format?: 'relative' | 'time' | 'datetime';
  /** Optional card title */
  title?: string;

  // === Message Input ===
  /** Show send message input (default: false) */
  show_input?: boolean;
  /** "service" | "entity" (default: service) */
  send_mode?: 'service' | 'entity';
  /** Service to call (send_mode: service) */
  send_service?: string;
  /** Additional service data */
  send_service_data?: Record<string, unknown>;
  /** Text entity (send_mode: entity) */
  send_text_entity?: string;
  /** Button to trigger (send_mode: entity) */
  send_trigger_entity?: string;

  // === Real-Time ===
  /** "auto" | "websocket" | "polling" (default: auto) */
  update_mode?: 'auto' | 'websocket' | 'polling';
  /** Polling interval in seconds (default: 30) */
  refresh_interval?: number;
  /** Custom event to subscribe to */
  event_type?: string;

  // === Cache ===
  /** Use localStorage cache (default: true) */
  enable_cache?: boolean;
  /** Cache TTL in seconds (default: 86400 = 24h) */
  cache_ttl?: number;
  /** Max cache size in bytes (default: 5MB) */
  cache_max_size?: number;

  // === Appearance ===
  /** Chat area max height (default: 400px) */
  max_height?: string;
  /** Max bubble width (default: 85%) */
  bubble_max_width?: string;
  /** Enable smooth scroll animations (default: false — causes issues on iOS) */
  smooth_scroll?: boolean;
}
