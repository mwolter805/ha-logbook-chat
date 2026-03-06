import type { CardConfig, PresetConfig } from './types';

/**
 * Card registration name
 */
export const CARD_TAG = 'ha-logbook-chat';
export const EDITOR_TAG = 'ha-logbook-chat-editor';

/**
 * Cache constants
 */
export const CACHE_VERSION = 1;
export const CACHE_KEY_PREFIX = 'ha-logbook-chat:';

/**
 * Regex patterns
 */
export const CHANNEL_PREFIX_REGEX = /^<[^>]+>\s*/;
export const SENDER_SPLIT_REGEX = /: /;
export const MENTION_BRACKET_REGEX = /@\[([^\]]+)\]/g;
export const MENTION_WORD_REGEX = /@(\w+)/g;

/**
 * Default config values
 */
export const DEFAULT_CONFIG: Partial<CardConfig> = {
  mode: 'external',
  hours_to_show: 48,
  max_messages: 500,
  show_search: false,
  show_date_separators: true,
  group_messages: true,
  group_timeout: 300,
  timestamp_format: 'relative',
  show_input: false,
  send_mode: 'service',
  update_mode: 'auto',
  refresh_interval: 10,
  enable_cache: true,
  cache_ttl: 86400,
  cache_max_size: 5242880,
  max_height: '400px',
  bubble_max_width: '85%',
  smooth_scroll: false,
};

/**
 * Named presets for specific integrations
 */
export const PRESETS: Record<string, PresetConfig> = {
  meshcore: {
    name: 'MeshCore',
    mode: 'external',
    recipient_type_entity: 'select.meshcore_recipient_type',
    channel_entity: 'select.meshcore_channel',
    contact_entity: 'select.meshcore_contact',
    channel_entity_pattern: 'binary_sensor.meshcore_{prefix}_ch_{idx}_messages',
    contact_entity_pattern: 'binary_sensor.meshcore_{prefix}_{contact}_messages',
    send_mode: 'service',
    send_service: 'meshcore.send_ui_message',
    send_text_entity: 'text.meshcore_message',
    domain_filter: 'meshcore',
  },
};

/**
 * Known config keys for validation (warn on unknown keys)
 */
export const KNOWN_CONFIG_KEYS = new Set<string>([
  'type',
  'node_name',
  'node_prefix',
  'preset',
  'mode',
  'recipient_type_entity',
  'channel_entity',
  'contact_entity',
  'channel_entity_pattern',
  'contact_entity_pattern',
  'entity',
  'domain_filter',
  'hours_to_show',
  'max_messages',
  'show_search',
  'show_date_separators',
  'group_messages',
  'group_timeout',
  'timestamp_format',
  'title',
  'show_input',
  'send_mode',
  'send_service',
  'send_service_data',
  'send_text_entity',
  'send_trigger_entity',
  'update_mode',
  'refresh_interval',
  'event_type',
  'enable_cache',
  'cache_ttl',
  'cache_max_size',
  'max_height',
  'bubble_max_width',
  'smooth_scroll',
  'card_mod',
]);

/**
 * Debounce delay for entity switches (ms)
 */
export const ENTITY_SWITCH_DEBOUNCE_MS = 300;

/**
 * Exponential backoff config for fetch retries
 */
export const FETCH_RETRY_BASE_MS = 1000;
export const FETCH_RETRY_MAX_MS = 30000;
export const FETCH_MAX_RETRIES = 5;

/**
 * Lazy loading configuration
 */
/** Initial time window in hours for first fetch (expand if too few messages) */
export const LAZY_LOAD_INITIAL_HOURS = 6;
/** Hours to go back for each "load older" batch */
export const LAZY_LOAD_BATCH_HOURS = 6;
/** Minimum messages before stopping adaptive expansion on initial load */
export const LAZY_LOAD_MIN_MESSAGES = 100;
/** Pixels from top of scroll container to trigger loading older messages */
export const LAZY_LOAD_SCROLL_THRESHOLD = 200;

/**
 * Incremental fetch overlap — seconds to look behind _lastFetchTimestamp.
 * Covers the gap between when a message arrives and when the logbook
 * recorder actually writes the entry (async pipeline delay).
 * Duplicates are safely deduped by message ID on merge.
 */
export const INCREMENTAL_OVERLAP_S = 30;
