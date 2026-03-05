import type { CardConfig, ChatMessage, HomeAssistant, LogbookEntry, CacheEntry } from './types';
import { parseLogbookEntries } from './message-parser';
import {
  CACHE_KEY_PREFIX,
  CACHE_VERSION,
  FETCH_RETRY_BASE_MS,
  FETCH_RETRY_MAX_MS,
  FETCH_MAX_RETRIES,
} from './constants';

/**
 * Manages message fetching, caching, and real-time updates.
 */
export class MessageStore {
  private _messages: ChatMessage[] = [];
  private _loading = false;
  private _error: string | null = null;
  private _entityId: string | null = null;
  private _config: CardConfig;
  private _hass: HomeAssistant | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _unsubscribe: (() => void) | null = null;
  private _retryCount = 0;
  private _onChange: (() => void) | null = null;
  private _lastFetchTimestamp: string | null = null;

  constructor(config: CardConfig) {
    this._config = config;
  }

  get messages(): ChatMessage[] {
    return this._messages;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): string | null {
    return this._error;
  }

  get entityId(): string | null {
    return this._entityId;
  }

  /**
   * Set the change callback — called whenever messages, loading, or error state changes.
   */
  setOnChange(callback: () => void): void {
    this._onChange = callback;
  }

  /**
   * Update the hass object (called on every hass change).
   */
  setHass(hass: HomeAssistant): void {
    this._hass = hass;
  }

  /**
   * Update config.
   */
  setConfig(config: CardConfig): void {
    this._config = config;
  }

  /**
   * Switch to a new entity. Triggers cache load + fresh fetch.
   */
  async switchEntity(entityId: string | null): Promise<void> {
    if (entityId === this._entityId) return;

    // Cleanup previous subscriptions
    this._stopUpdates();

    this._entityId = entityId;
    this._messages = [];
    this._error = null;
    this._retryCount = 0;
    this._lastFetchTimestamp = null;

    if (!entityId) {
      this._notify();
      return;
    }

    // Load from cache first (instant render)
    if (this._config.enable_cache !== false) {
      const cached = this._loadCache(entityId);
      if (cached) {
        this._messages = cached;
        this._notify();
      }
    }

    // Fetch fresh data
    await this._fetchMessages(entityId, false);

    // Start real-time updates
    this._startUpdates(entityId);
  }

  /**
   * Force a full refresh.
   */
  async refresh(): Promise<void> {
    if (this._entityId) {
      await this._fetchMessages(this._entityId, false);
    }
  }

  /**
   * Cleanup — stop polling, unsubscribe events.
   */
  destroy(): void {
    this._stopUpdates();
    this._onChange = null;
  }

  /**
   * Fetch messages from the HA logbook API.
   */
  private async _fetchMessages(entityId: string, incremental: boolean): Promise<void> {
    if (!this._hass) return;

    this._loading = true;
    this._notify();

    try {
      const hoursToShow = this._config.hours_to_show ?? 48;
      let startTime: string;

      if (incremental && this._lastFetchTimestamp) {
        startTime = this._lastFetchTimestamp;
      } else {
        const start = new Date();
        start.setHours(start.getHours() - hoursToShow);
        startTime = start.toISOString();
      }

      const endTime = new Date().toISOString();
      const path = `logbook/${startTime}?entity=${entityId}&end_time=${endTime}`;

      const entries = await this._hass.callApi<LogbookEntry[]>('GET', path);

      const parsed = parseLogbookEntries(entries, {
        node_name: this._config.node_name,
        domain_filter: this._config.domain_filter,
      });

      if (incremental && this._messages.length > 0) {
        // Merge new messages, avoiding duplicates by ID
        const existingIds = new Set(this._messages.map((m) => m.id));
        const newMessages = parsed.filter((m) => !existingIds.has(m.id));
        this._messages = [...this._messages, ...newMessages];
      } else {
        this._messages = parsed;
      }

      // Enforce max_messages limit
      const maxMessages = this._config.max_messages ?? 500;
      if (this._messages.length > maxMessages) {
        this._messages = this._messages.slice(-maxMessages);
      }

      // Sort by timestamp
      this._messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Update cache
      if (this._config.enable_cache !== false) {
        this._saveCache(entityId, this._messages);
      }

      this._lastFetchTimestamp = endTime;
      this._error = null;
      this._retryCount = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error = `Failed to fetch messages: ${message}`;
      console.error(`[ha-logbook-chat] Fetch error for ${entityId}:`, err);
      this._retryCount++;
    } finally {
      this._loading = false;
      this._notify();
    }
  }

  /**
   * Start real-time updates (WebSocket or polling).
   */
  private _startUpdates(entityId: string): void {
    const mode = this._config.update_mode ?? 'auto';

    if (mode === 'polling') {
      this._startPolling(entityId);
      return;
    }

    // Try WebSocket first (auto or websocket mode)
    this._subscribeWebSocket(entityId).catch(() => {
      if (mode === 'auto') {
        console.info('[ha-logbook-chat] WebSocket subscription failed, falling back to polling');
        this._startPolling(entityId);
      }
    });
  }

  /**
   * Subscribe to state_changed events via WebSocket.
   */
  private async _subscribeWebSocket(entityId: string): Promise<void> {
    if (!this._hass) return;

    try {
      const unsub = await this._hass.connection.subscribeEvents((event) => {
        if (event.data.entity_id === entityId && event.data.new_state) {
          // State changed — fetch incremental updates
          this._fetchMessages(entityId, true);
        }
      }, 'state_changed');

      this._unsubscribe = unsub;

      // Also subscribe to custom event type if configured
      if (this._config.event_type) {
        const unsubCustom = await this._hass.connection.subscribeEvents(() => {
          this._fetchMessages(entityId, true);
        }, this._config.event_type);

        const prevUnsub = this._unsubscribe;
        this._unsubscribe = () => {
          prevUnsub();
          unsubCustom();
        };
      }
    } catch (err) {
      console.warn('[ha-logbook-chat] WebSocket subscription failed:', err);
      throw err;
    }
  }

  /**
   * Start polling for updates at a regular interval.
   */
  private _startPolling(entityId: string): void {
    const interval = (this._config.refresh_interval ?? 30) * 1000;

    this._pollTimer = setInterval(() => {
      if (this._retryCount >= FETCH_MAX_RETRIES) {
        // Exponential backoff
        const backoff = Math.min(
          FETCH_RETRY_BASE_MS * Math.pow(2, this._retryCount - FETCH_MAX_RETRIES),
          FETCH_RETRY_MAX_MS,
        );
        setTimeout(() => this._fetchMessages(entityId, true), backoff);
      } else {
        this._fetchMessages(entityId, true);
      }
    }, interval);
  }

  /**
   * Stop all real-time updates.
   */
  private _stopUpdates(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  /**
   * Notify the card that state changed.
   */
  private _notify(): void {
    if (this._onChange) {
      this._onChange();
    }
  }

  // === Cache Operations ===

  private _cacheKey(entityId: string): string {
    return `${CACHE_KEY_PREFIX}${entityId}`;
  }

  private _loadCache(entityId: string): ChatMessage[] | null {
    try {
      const raw = localStorage.getItem(this._cacheKey(entityId));
      if (!raw) return null;

      const entry: CacheEntry = JSON.parse(raw);

      // Version check
      if (entry.version !== CACHE_VERSION) {
        localStorage.removeItem(this._cacheKey(entityId));
        return null;
      }

      // TTL check
      const ttl = (this._config.cache_ttl ?? 86400) * 1000;
      if (Date.now() - entry.lastFetched > ttl) {
        localStorage.removeItem(this._cacheKey(entityId));
        return null;
      }

      // Restore Date objects
      return entry.messages.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    } catch {
      // Corrupted cache — clear it
      try {
        localStorage.removeItem(this._cacheKey(entityId));
      } catch {
        // Ignore
      }
      return null;
    }
  }

  private _saveCache(entityId: string, messages: ChatMessage[]): void {
    try {
      const entry: CacheEntry = {
        entityId,
        messages,
        lastFetched: Date.now(),
        oldestMessage: messages.length > 0 ? messages[0].timestamp.getTime() : 0,
        newestMessage: messages.length > 0 ? messages[messages.length - 1].timestamp.getTime() : 0,
        version: CACHE_VERSION,
      };

      const serialized = JSON.stringify(entry);

      // Check size limit
      const maxSize = this._config.cache_max_size ?? 5242880;
      if (serialized.length > maxSize) {
        // Evict oldest entries to make room
        this._evictCache(serialized.length - maxSize);
      }

      localStorage.setItem(this._cacheKey(entityId), serialized);
    } catch {
      // localStorage full or unavailable — silently fail
      console.warn('[ha-logbook-chat] Failed to save cache');
    }
  }

  private _evictCache(bytesNeeded: number): void {
    const keysToEvict: Array<{ key: string; lastFetched: number; size: number }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(CACHE_KEY_PREFIX)) continue;

      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const entry: CacheEntry = JSON.parse(raw);
        keysToEvict.push({ key, lastFetched: entry.lastFetched, size: raw.length });
      } catch {
        // Corrupted entry — mark for removal
        keysToEvict.push({ key, lastFetched: 0, size: 0 });
      }
    }

    // Sort by oldest first (LRU)
    keysToEvict.sort((a, b) => a.lastFetched - b.lastFetched);

    let freed = 0;
    for (const item of keysToEvict) {
      if (freed >= bytesNeeded) break;
      localStorage.removeItem(item.key);
      freed += item.size;
    }
  }
}
