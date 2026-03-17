import type { CardConfig, ChatMessage, HomeAssistant, LogbookEntry, CacheEntry } from './types';
import { parseLogbookEntries } from './message-parser';
import {
  CACHE_KEY_PREFIX,
  CACHE_VERSION,
  FETCH_MAX_RETRIES,
  LAZY_LOAD_INITIAL_HOURS,
  LAZY_LOAD_MIN_MESSAGES,
  INCREMENTAL_OVERLAP_S,
} from './constants';

/** Poll interval when API is erroring (30 seconds) */
const ERROR_POLL_INTERVAL_MS = 30_000;

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
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _unsubscribe: (() => void) | null = null;
  private _retryCount = 0;
  private _onChange: (() => void) | null = null;
  private _lastFetchTimestamp: string | null = null;
  private _lastEntityUpdated: string | null = null;
  private _fetchDebounce: ReturnType<typeof setTimeout> | null = null;
  private _active = false;

  // Lazy loading state
  private _oldestLoadedTime: string | null = null;
  private _hasOlderMessages = true;
  private _loadingOlder = false;
  private _initialFetchDone = false;

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

  get loadingOlder(): boolean {
    return this._loadingOlder;
  }

  get hasOlderMessages(): boolean {
    return this._hasOlderMessages;
  }

  /**
   * Set the change callback — called whenever messages, loading, or error state changes.
   */
  setOnChange(callback: () => void): void {
    this._onChange = callback;
  }

  /**
   * Update the hass object (called on every hass change).
   * Also checks if the watched entity's last_updated changed.
   */
  setHass(hass: HomeAssistant): void {
    this._hass = hass;

    // Check if the watched entity's last_updated has changed
    if (this._entityId && this._active) {
      const entity = hass.states[this._entityId];
      if (entity) {
        const lastUpdated = entity.last_updated ?? entity.last_changed;
        if (lastUpdated && lastUpdated !== this._lastEntityUpdated) {
          const hadPrevious = this._lastEntityUpdated !== null;
          this._lastEntityUpdated = lastUpdated;

          if (hadPrevious) {
            if (this._fetchDebounce) {
              clearTimeout(this._fetchDebounce);
            }
            this._fetchDebounce = setTimeout(() => {
              this._fetchDebounce = null;
              this._fetchMessages(this._entityId!, false).catch(() => {});
            }, 500);
          }
        }
      }
    }
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
    this._lastEntityUpdated = null;
    this._retryCount = 0;
    this._lastFetchTimestamp = null;
    this._oldestLoadedTime = null;
    this._hasOlderMessages = true;
    this._loadingOlder = false;
    this._initialFetchDone = false;

    if (!entityId) {
      this._active = false;
      this._notify();
      return;
    }

    // Set active BEFORE async work so setHass() last_updated watch works immediately
    this._active = true;

    // Load from cache first (instant render)
    if (this._config.enable_cache !== false) {
      const cached = this._loadCache(entityId);
      if (cached) {
        this._messages = cached;
        this._notify();
      }
    }

    // Start real-time updates before the fetch so polling is running even if fetch is slow
    this._startUpdates(entityId);

    // Fetch fresh data
    await this._fetchMessages(entityId, false);
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
   * Add a local optimistic message immediately (before API confirmation).
   */
  addOptimisticMessage(sender: string, text: string): void {
    const now = new Date();
    const tempId = `optimistic_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;

    const msg: ChatMessage = {
      id: tempId,
      sender,
      text,
      timestamp: now,
      isOutgoing: true,
      isSystem: false,
      raw: `${sender}: ${text}`,
      mentions: [],
    };

    this._messages = [...this._messages, msg];
    this._notify();
  }

  /**
   * Load older messages by fetching an earlier time window.
   * Called when user scrolls near the top of the chat.
   */
  async loadOlderMessages(): Promise<void> {
    if (this._loadingOlder || !this._hasOlderMessages || !this._hass || !this._entityId) {
      return;
    }

    this._loadingOlder = true;
    this._notify();

    try {
      const hoursToShow = this._config.hours_to_show ?? 48;
      const absoluteOldest = new Date();
      absoluteOldest.setHours(absoluteOldest.getHours() - hoursToShow);

      // End time: use whichever is older — the oldest displayed message or
      // _oldestLoadedTime. This prevents re-scanning the same empty gap when
      // a previous batch returned 0 results (message history has gaps).
      let endTime: string;
      const oldestMsgTime =
        this._messages.length > 0 ? this._messages[0].timestamp.toISOString() : null;

      if (oldestMsgTime && this._oldestLoadedTime) {
        // Use whichever is further back in time
        endTime = oldestMsgTime < this._oldestLoadedTime ? oldestMsgTime : this._oldestLoadedTime;
      } else if (oldestMsgTime) {
        endTime = oldestMsgTime;
      } else if (this._oldestLoadedTime) {
        endTime = this._oldestLoadedTime;
      } else {
        endTime = new Date().toISOString();
      }

      // Batch size scales with initial_hours to keep lazy-load responses fast
      // on active channels (e.g., initial_hours=1 → batch=3h instead of 6h)
      const initHours = this._config.initial_hours ?? LAZY_LOAD_INITIAL_HOURS;
      const batchHours = Math.max(initHours * 3, LAZY_LOAD_INITIAL_HOURS);

      // Start time is batchHours before the end time
      const endDate = new Date(endTime);
      const startDate = new Date(endDate);
      startDate.setHours(startDate.getHours() - batchHours);

      // Clamp to the absolute oldest allowed
      if (startDate.getTime() <= absoluteOldest.getTime()) {
        startDate.setTime(absoluteOldest.getTime());
        this._hasOlderMessages = false;
      }

      // If start and end are the same (or start is after end), nothing more to load
      if (startDate.getTime() >= endDate.getTime()) {
        this._hasOlderMessages = false;
        return;
      }

      const startTime = startDate.toISOString();
      const path = `logbook/${startTime}?entity=${this._entityId}&end_time=${endTime}`;
      const entries = await this._hass.callApi<LogbookEntry[]>('GET', path);

      const parsed = parseLogbookEntries(entries, {
        node_name: this._config.node_name,
        domain_filter: this._config.domain_filter,
      });

      if (parsed.length === 0 && this._hasOlderMessages) {
        this._hasOlderMessages = startDate.getTime() > absoluteOldest.getTime();
        if (this._hasOlderMessages) {
          this._oldestLoadedTime = startTime;
        }
        return;
      }

      // Deduplicate against existing messages
      const existingIds = new Set(this._messages.map((m) => m.id));
      const newMessages = parsed.filter((m) => !existingIds.has(m.id));

      // Prepend older messages
      if (newMessages.length > 0) {
        this._messages = [...newMessages, ...this._messages];
        this._messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        // Note: we do NOT enforce max_messages here — the user is explicitly
        // scrolling up to see more history. The limit is naturally bounded
        // by hours_to_show and the hasOlderMessages flag.
      }

      this._oldestLoadedTime = startTime;

      if (this._config.enable_cache !== false) {
        this._saveCache(this._entityId, this._messages);
      }
    } catch {
      // Silently fail — user can try scrolling up again
    } finally {
      this._loadingOlder = false;
      this._notify();
    }
  }

  /**
   * Pause updates — stop polling and WebSocket, but keep onChange callback.
   */
  pause(): void {
    this._stopUpdates();
    this._active = false;
    if (this._fetchDebounce) {
      clearTimeout(this._fetchDebounce);
      this._fetchDebounce = null;
    }
  }

  /**
   * Resume updates — restart polling and WebSocket.
   */
  async resume(): Promise<void> {
    if (this._entityId && !this._active) {
      this._active = true;
      this._startUpdates(this._entityId);
      await this._fetchMessages(this._entityId, false);
    }
  }

  /**
   * Full cleanup — only for permanent discard.
   */
  destroy(): void {
    this._stopUpdates();
    this._active = false;
    if (this._fetchDebounce) {
      clearTimeout(this._fetchDebounce);
      this._fetchDebounce = null;
    }
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
      const endTime = new Date().toISOString();
      let parsed: ChatMessage[];

      // After the first fetch, all subsequent fetches should be incremental
      // (only fetch new messages since last fetch timestamp) to avoid
      // re-running the expensive adaptive time window expansion every poll.
      const useIncremental = (incremental || this._initialFetchDone) && this._lastFetchTimestamp;

      if (useIncremental) {
        // Look slightly behind _lastFetchTimestamp to catch logbook entries
        // that were written asynchronously after the previous fetch ran.
        // Duplicates are safely deduped by message ID on merge.
        const overlap = new Date(this._lastFetchTimestamp!);
        overlap.setSeconds(overlap.getSeconds() - INCREMENTAL_OVERLAP_S);
        const startTime = overlap.toISOString();
        const path = `logbook/${startTime}?entity=${entityId}&end_time=${endTime}`;
        const entries = await this._hass.callApi<LogbookEntry[]>('GET', path);

        parsed = parseLogbookEntries(entries, {
          node_name: this._config.node_name,
          domain_filter: this._config.domain_filter,
        });
      } else {
        // Initial/full fetch — fast first paint with progressive expansion.
        // Steps: initial_hours → 3x initial_hours → 6x initial_hours.
        // Stops early if enough messages found. Older history is lazy-loaded on scroll.
        const maxMessages = this._config.max_messages ?? 500;
        const targetMin = Math.min(LAZY_LOAD_MIN_MESSAGES, maxMessages);
        const initHours = this._config.initial_hours ?? LAZY_LOAD_INITIAL_HOURS;
        const expansionSteps = [
          initHours,
          initHours * 3,
          initHours * 6,
        ].filter((h) => h <= hoursToShow);
        // Deduplicate in case rounding produces identical steps
        const uniqueSteps = [...new Set(expansionSteps)];

        parsed = [];
        let usedHours = 0;

        for (const hours of uniqueSteps) {
          const start = new Date();
          start.setHours(start.getHours() - hours);
          const startTime = start.toISOString();
          const path = `logbook/${startTime}?entity=${entityId}&end_time=${endTime}`;
          const entries = await this._hass.callApi<LogbookEntry[]>('GET', path);

          parsed = parseLogbookEntries(entries, {
            node_name: this._config.node_name,
            domain_filter: this._config.domain_filter,
          });
          usedHours = hours;

          if (parsed.length >= targetMin) {
            break;
          }
        }

        // Track oldest loaded time for lazy loading
        const oldestStart = new Date();
        oldestStart.setHours(oldestStart.getHours() - usedHours);
        this._oldestLoadedTime = oldestStart.toISOString();
        // Always enable lazy loading — initial fetch is intentionally small for fast load.
        // Full hours_to_show range is accessible via scroll-up lazy loading.
        this._hasOlderMessages = true;
        this._initialFetchDone = true;
      }

      if (useIncremental && this._messages.length > 0) {
        const existingIds = new Set<string>();
        const kept: ChatMessage[] = [];
        for (const m of this._messages) {
          if (m.id.startsWith('optimistic_') && parsed.length > 0) {
            const hasReal = parsed.some((p) => p.sender === m.sender && p.text === m.text);
            if (hasReal) continue;
          }
          existingIds.add(m.id);
          kept.push(m);
        }
        const newMessages = parsed.filter((m) => !existingIds.has(m.id));
        this._messages = [...kept, ...newMessages];
      } else {
        this._messages = parsed;
      }

      // Enforce max_messages limit (keep newest, trim oldest)
      const maxMessages = this._config.max_messages ?? 500;
      if (this._messages.length > maxMessages) {
        this._messages = this._messages.slice(-maxMessages);
        // Older messages were trimmed, so lazy loading can retrieve them
        this._hasOlderMessages = true;
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
      this._retryCount++;
    } finally {
      this._loading = false;
      this._notify();
    }
  }

  /**
   * Start real-time updates (WebSocket + polling).
   */
  private _startUpdates(entityId: string): void {
    const mode = this._config.update_mode ?? 'auto';

    this._startPolling(entityId);

    if (mode !== 'polling') {
      this._subscribeWebSocket(entityId).catch(() => {
        // WebSocket failed, polling is still active as fallback
      });
    }
  }

  /**
   * Subscribe to WebSocket events for real-time updates.
   */
  private async _subscribeWebSocket(entityId: string): Promise<void> {
    if (!this._hass) return;

    const unsubs: Array<() => void> = [];

    try {
      // Helper: fire-and-forget fetch that swallows unexpected errors
      const safeFetch = () => this._fetchMessages(entityId, false).catch(() => {});

      // 1. state_changed — standard HA pattern
      const unsubState = await this._hass.connection.subscribeEvents((event: any) => {
        if (event.data.entity_id === entityId && event.data.new_state) {
          safeFetch();
        }
      }, 'state_changed');
      unsubs.push(unsubState);

      // 2. meshcore_message — fires BEFORE logbook entry is written,
      //    so we delay to let the logbook pipeline complete.
      const unsubMeshcore = await this._hass.connection.subscribeEvents((event: any) => {
        const d = event.data;
        if (d.entity_id === entityId) {
          // First fetch after 500ms
          setTimeout(() => safeFetch(), 500);
          // Safety net after 2s
          setTimeout(() => safeFetch(), 2000);
        }
      }, 'meshcore_message');
      unsubs.push(unsubMeshcore);

      // 3. Custom event_type — user-configured
      if (this._config.event_type) {
        const unsubCustom = await this._hass.connection.subscribeEvents(() => {
          safeFetch();
        }, this._config.event_type);
        unsubs.push(unsubCustom);
      }

      this._unsubscribe = () => {
        unsubs.forEach((fn) => fn());
      };
    } catch (err) {
      unsubs.forEach((fn) => fn());
      throw err;
    }
  }

  /**
   * Start polling for updates.
   * Uses setTimeout (not setInterval) so the interval can adapt:
   * - Normal: uses configured refresh_interval (default 10s)
   * - On API errors: slows down to 30s to avoid hammering a failing API
   */
  private _startPolling(entityId: string): void {
    const normalInterval = (this._config.refresh_interval ?? 10) * 1000;

    const schedulePoll = () => {
      if (!this._active) return;

      const interval =
        this._retryCount >= FETCH_MAX_RETRIES ? ERROR_POLL_INTERVAL_MS : normalInterval;

      this._pollTimer = setTimeout(async () => {
        if (!this._active) return;
        try {
          await this._fetchMessages(entityId, false);
        } catch {
          // _fetchMessages has its own error handling;
          // this catches truly unexpected failures (e.g. _notify throws)
        }
        schedulePoll();
      }, interval);
    };

    schedulePoll();
  }

  /**
   * Stop all real-time updates.
   */
  private _stopUpdates(): void {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
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

      if (entry.version !== CACHE_VERSION) {
        localStorage.removeItem(this._cacheKey(entityId));
        return null;
      }

      const ttl = (this._config.cache_ttl ?? 86400) * 1000;
      if (Date.now() - entry.lastFetched > ttl) {
        localStorage.removeItem(this._cacheKey(entityId));
        return null;
      }

      return entry.messages.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    } catch {
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
      const realMessages = messages.filter((m) => !m.id.startsWith('optimistic_'));

      const entry: CacheEntry = {
        entityId,
        messages: realMessages,
        lastFetched: Date.now(),
        oldestMessage: realMessages.length > 0 ? realMessages[0].timestamp.getTime() : 0,
        newestMessage:
          realMessages.length > 0 ? realMessages[realMessages.length - 1].timestamp.getTime() : 0,
        version: CACHE_VERSION,
      };

      const serialized = JSON.stringify(entry);

      const maxSize = this._config.cache_max_size ?? 5242880;
      if (serialized.length > maxSize) {
        this._evictCache(serialized.length - maxSize);
      }

      localStorage.setItem(this._cacheKey(entityId), serialized);
    } catch {
      // Cache save failed silently
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
        keysToEvict.push({ key, lastFetched: 0, size: 0 });
      }
    }

    keysToEvict.sort((a, b) => a.lastFetched - b.lastFetched);

    let freed = 0;
    for (const item of keysToEvict) {
      if (freed >= bytesNeeded) break;
      localStorage.removeItem(item.key);
      freed += item.size;
    }
  }
}
