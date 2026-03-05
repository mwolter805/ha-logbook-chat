import { LitElement, html, nothing, type TemplateResult, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { CardConfig, HomeAssistant, ChatMessage, RenderItem } from './types';
import {
  resolveEntity,
  discoverChannels,
  discoverContacts,
  type ResolvedEntity,
} from './entity-resolver';
import { MessageStore } from './message-store';
import { buildRenderItems, formatTimestamp } from './message-parser';
import { cardStyles } from './styles';
import {
  CARD_TAG,
  EDITOR_TAG,
  DEFAULT_CONFIG,
  PRESETS,
  KNOWN_CONFIG_KEYS,
  ENTITY_SWITCH_DEBOUNCE_MS,
  LAZY_LOAD_SCROLL_THRESHOLD,
} from './constants';

// Re-export for HACS/HA registration
import './editor';

const SEND_ICON = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="currentColor"
>
  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
</svg>`;

@customElement(CARD_TAG)
export class HaLogbookChat extends LitElement {
  static styles = cardStyles;

  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _config!: CardConfig;
  @state() private _resolved: ResolvedEntity = {
    entityId: null,
    recipientType: null,
    label: '',
    error: null,
  };
  @state() private _renderItems: RenderItem[] = [];
  @state() private _loading = false;
  @state() private _error: string | null = null;
  @state() private _searchQuery = '';
  @state() private _showCopiedToast = false;
  @state() private _hasNewMessages = false;
  @state() private _inputText = '';
  @state() private _sending = false;
  @state() private _loadingOlder = false;

  // Builtin mode state
  @state() private _builtinType: 'channel' | 'contact' = 'channel';
  @state() private _builtinChannels: Array<{ name: string; idx: number; entityId: string }> = [];
  @state() private _builtinContacts: Array<{ name: string; prefix: string; entityId: string }> = [];
  @state() private _builtinSelectedChannel = 0;
  @state() private _builtinSelectedContact = '';

  private _store!: MessageStore;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _userScrolledUp = false;
  private _initialScrollDone = false;
  private _chatContainer: HTMLElement | null = null;
  private _previousEntityId: string | null = null;
  // Safety-net: track last known message count + newest ID to detect missed updates
  private _lastKnownMsgCount = 0;
  private _lastKnownMsgId: string | null = null;
  // Scroll preservation for lazy-load prepend
  private _scrollHeightBeforeUpdate: number | null = null;

  // HA card API
  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig(): Record<string, unknown> {
    return {
      type: `custom:${CARD_TAG}`,
      node_name: '',
      preset: 'meshcore',
    };
  }

  setConfig(config: CardConfig): void {
    if (!config.node_name) {
      throw new Error('Configuration requires "node_name"');
    }
    if (config.mode === 'static' && !config.entity) {
      throw new Error('Static mode requires "entity" configuration');
    }
    if (!config.mode || config.mode !== 'static') {
      // Non-static modes need node_prefix unless a preset provides defaults
      if (!config.node_prefix && !config.preset) {
        // This is a warning, not an error — will work if entity patterns resolve
      }
    }
    if (config.show_input) {
      const sendMode = config.send_mode ?? 'service';
      if (sendMode === 'service' && !config.send_service && !config.preset) {
        throw new Error('Message input requires "send_service" or a preset');
      }
      if (sendMode === 'entity' && !config.send_text_entity && !config.preset) {
        throw new Error('Entity send mode requires "send_text_entity"');
      }
    }

    // Warn on unknown keys
    for (const key of Object.keys(config)) {
      if (!KNOWN_CONFIG_KEYS.has(key)) {
        console.warn(`[ha-logbook-chat] Unknown config key: "${key}"`);
      }
    }

    // Merge preset defaults → default config → user config
    const preset = config.preset ? PRESETS[config.preset] : undefined;
    this._config = {
      ...DEFAULT_CONFIG,
      ...(preset
        ? {
            mode: preset.mode,
            recipient_type_entity: preset.recipient_type_entity,
            channel_entity: preset.channel_entity,
            contact_entity: preset.contact_entity,
            channel_entity_pattern: preset.channel_entity_pattern,
            contact_entity_pattern: preset.contact_entity_pattern,
            send_mode: preset.send_mode,
            send_service: preset.send_service,
            send_text_entity: preset.send_text_entity,
            domain_filter: preset.domain_filter,
          }
        : {}),
      ...config,
    } as CardConfig;

    // Initialize or reconfigure store
    if (!this._store) {
      this._store = new MessageStore(this._config);
      this._store.setOnChange(() => this._onStoreUpdate());
    } else {
      this._store.setConfig(this._config);
    }
  }

  getCardSize(): number {
    return 6;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this._store) {
      this._store.resume();
    }

    this.updateComplete.then(() => {
      this._scrollToBottom(false);
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._store?.pause();
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);

    if (changedProps.has('hass') && this.hass) {
      this._store.setHass(this.hass);
      this._resolveAndFetch();
      this._checkForMissedUpdates();
    }

    this._applyCssProperties();
  }

  /**
   * Safety net: compare store's current messages against what we last rendered.
   * If they differ, force _onStoreUpdate() to sync the UI.
   */
  private _checkForMissedUpdates(): void {
    if (!this._store) return;
    const msgs = this._store.messages;
    const count = msgs.length;
    const newestId = count > 0 ? msgs[count - 1].id : null;

    if (count !== this._lastKnownMsgCount || newestId !== this._lastKnownMsgId) {
      this._lastKnownMsgCount = count;
      this._lastKnownMsgId = newestId;
      this._onStoreUpdate();
    }
  }

  private _applyCssProperties(): void {
    if (!this._config) return;

    if (this._config.max_height) {
      this.style.setProperty('--chat-card-max-height', this._config.max_height);
    }
    if (this._config.bubble_max_width) {
      this.style.setProperty('--bubble-max-width', this._config.bubble_max_width);
    }
  }

  private _resolveAndFetch(): void {
    if (!this.hass || !this._config) return;

    let resolved: ResolvedEntity;

    if (this._config.mode === 'builtin') {
      resolved = this._resolveBuiltin();
    } else {
      resolved = resolveEntity(this.hass, this._config);
    }

    this._resolved = resolved;

    // Debounce entity switches
    if (resolved.entityId !== this._previousEntityId) {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      // Reset scroll state on entity switch so the "new messages" badge
      // doesn't appear immediately on first load / channel switch
      this._userScrolledUp = false;
      this._hasNewMessages = false;
      this._initialScrollDone = false;
      this._debounceTimer = setTimeout(() => {
        this._previousEntityId = resolved.entityId;
        this._store.switchEntity(resolved.entityId);
      }, ENTITY_SWITCH_DEBOUNCE_MS);
    }

    // Update builtin mode discovery
    if (this._config.mode === 'builtin' && this.hass) {
      this._builtinChannels = discoverChannels(this.hass, this._config);
      this._builtinContacts = discoverContacts(this.hass, this._config);
    }
  }

  private _resolveBuiltin(): ResolvedEntity {
    if (!this.hass) {
      return { entityId: null, recipientType: null, label: '', error: 'No hass' };
    }

    if (this._builtinType === 'channel') {
      const channel = this._builtinChannels.find((c) => c.idx === this._builtinSelectedChannel);
      if (channel) {
        return {
          entityId: channel.entityId,
          recipientType: 'channel',
          label: channel.name,
          error: null,
        };
      }
      // Try discovering
      const channels = discoverChannels(this.hass, this._config);
      if (channels.length > 0) {
        return {
          entityId: channels[0].entityId,
          recipientType: 'channel',
          label: channels[0].name,
          error: null,
        };
      }
      return { entityId: null, recipientType: 'channel', label: 'No channels found', error: null };
    } else {
      const contact = this._builtinContacts.find((c) => c.prefix === this._builtinSelectedContact);
      if (contact) {
        return {
          entityId: contact.entityId,
          recipientType: 'contact',
          label: contact.name,
          error: null,
        };
      }
      return {
        entityId: null,
        recipientType: 'contact',
        label: 'No contact selected',
        error: null,
      };
    }
  }

  private _onStoreUpdate(): void {
    this._loading = this._store.loading;
    this._error = this._store.error;
    const wasLoadingOlder = this._loadingOlder;
    this._loadingOlder = this._store.loadingOlder;

    const messages = this._store.messages;
    this._renderItems = buildRenderItems(messages, this._config);

    // Keep safety-net tracker in sync
    this._lastKnownMsgCount = messages.length;
    this._lastKnownMsgId = messages.length > 0 ? messages[messages.length - 1].id : null;

    // Check for new messages when user has scrolled up
    // Only show badge after initial scroll-to-bottom has completed,
    // otherwise the badge appears immediately on card open / entity switch
    if (this._initialScrollDone && this._userScrolledUp && messages.length > 0) {
      this._hasNewMessages = true;
    }

    // Capture scroll height before render if we just finished loading older messages
    // (wasLoadingOlder was true and now it's false = older messages were prepended)
    if (wasLoadingOlder && !this._loadingOlder) {
      const container = this._chatContainer ?? this.shadowRoot?.querySelector('.chat-container');
      if (container) {
        this._scrollHeightBeforeUpdate = container.scrollHeight;
      }
    }

    this.requestUpdate();

    // Preserve scroll position after older messages are prepended
    if (this._scrollHeightBeforeUpdate !== null) {
      const savedHeight = this._scrollHeightBeforeUpdate;
      this._scrollHeightBeforeUpdate = null;
      this.updateComplete.then(() => {
        const container = this._chatContainer ?? this.shadowRoot?.querySelector('.chat-container');
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop += newScrollHeight - savedHeight;
        }
      });
    } else if (!this._userScrolledUp) {
      // Auto-scroll if not manually scrolled up
      // Use instant scroll until the first scroll completes — smooth scroll
      // triggers intermediate _onScroll events that falsely set _userScrolledUp
      const useSmooth = this._initialScrollDone;
      this.updateComplete.then(() => {
        this._scrollToBottom(useSmooth);
        if (!this._initialScrollDone) {
          // Mark initial scroll done after a tick so _onScroll settles
          requestAnimationFrame(() => {
            this._initialScrollDone = true;
          });
        }
      });
    }
  }

  // === Render ===

  protected render(): TemplateResult {
    if (!this._config) return html``;

    return html`
      <ha-card>
        ${this._renderHeader()} ${this._renderSearchBar()} ${this._renderEntitySelector()}
        ${this._renderChatArea()} ${this._renderInputArea()} ${this._renderCopiedToast()}
      </ha-card>
    `;
  }

  private _renderHeader(): TemplateResult | typeof nothing {
    const title = this._config.title;
    if (!title) return nothing;

    const count = this._store?.messages?.length ?? 0;
    return html`
      <div class="header" part="header">
        <span class="title">${title}</span>
        <span class="message-count">${count} messages</span>
      </div>
    `;
  }

  private _renderSearchBar(): TemplateResult | typeof nothing {
    if (!this._config.show_search) return nothing;
    return html`
      <div class="search-bar" part="search-bar">
        <input
          type="text"
          placeholder="Search messages..."
          .value=${this._searchQuery}
          @input=${this._onSearchInput}
        />
      </div>
    `;
  }

  private _renderEntitySelector(): TemplateResult | typeof nothing {
    if (this._config.mode !== 'builtin') return nothing;

    return html`
      <div class="entity-selector" part="entity-selector">
        <div class="type-tabs">
          <button
            class=${this._builtinType === 'channel' ? 'active' : ''}
            @click=${() => this._setBuiltinType('channel')}
          >
            Channels
          </button>
          <button
            class=${this._builtinType === 'contact' ? 'active' : ''}
            @click=${() => this._setBuiltinType('contact')}
          >
            Contacts
          </button>
        </div>
        ${this._builtinType === 'channel'
          ? html`
              <select @change=${this._onChannelSelect}>
                ${this._builtinChannels.map(
                  (ch) => html`
                    <option value=${ch.idx} ?selected=${ch.idx === this._builtinSelectedChannel}>
                      ${ch.name}
                    </option>
                  `,
                )}
              </select>
            `
          : html`
              <select @change=${this._onContactSelect}>
                <option value="">Select a contact...</option>
                ${this._builtinContacts.map(
                  (ct) => html`
                    <option
                      value=${ct.prefix}
                      ?selected=${ct.prefix === this._builtinSelectedContact}
                    >
                      ${ct.name}
                    </option>
                  `,
                )}
              </select>
            `}
      </div>
    `;
  }

  private _renderChatArea(): TemplateResult {
    return html`
      <div
        class="chat-container"
        part="chat-container"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        @scroll=${this._onScroll}
      >
        ${this._loading && this._renderItems.length === 0
          ? this._renderLoading()
          : this._renderItems.length === 0
            ? this._renderEmpty()
            : this._renderMessages()}
        ${this._error ? this._renderError() : nothing}
        ${this._hasNewMessages ? this._renderUnreadBadge() : nothing}
      </div>
    `;
  }

  private _renderLoading(): TemplateResult {
    return html`
      <div class="loading-state">
        <div class="loading-spinner"></div>
        Loading messages...
      </div>
    `;
  }

  private _renderEmpty(): TemplateResult {
    const label = this._resolved.label || 'this channel';
    return html`
      <div class="empty-state" part="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-text">No messages in ${label}</div>
      </div>
    `;
  }

  private _renderError(): TemplateResult {
    return html` <div class="error-state" part="error-state">⚠ ${this._error}</div> `;
  }

  private _renderMessages(): TemplateResult {
    const filteredItems = this._searchQuery
      ? this._filterBySearch(this._renderItems)
      : this._renderItems;

    return html`
      ${this._loadingOlder
        ? html`<div class="loading-older"><div class="loading-spinner"></div></div>`
        : this._store?.hasOlderMessages
          ? html`<div class="load-older-hint">Scroll up for older messages</div>`
          : nothing}
      ${filteredItems.map((item) => {
        if (item.type === 'date-separator') {
          return html` <div class="date-separator" part="date-separator">${item.label}</div> `;
        }
        return this._renderMessageGroup(item.group);
      })}
    `;
  }

  private _renderMessageGroup(group: import('./types').MessageGroup): TemplateResult {
    const align = group.isSystem ? 'system' : group.isOutgoing ? 'outgoing' : 'incoming';
    const tsFormat = this._config.timestamp_format ?? 'relative';
    const lastMsg = group.messages[group.messages.length - 1];

    return html`
      <div class="message-group ${align}" part="message-group">
        ${!group.isOutgoing && !group.isSystem
          ? html`<div class="sender" part="sender">${group.sender}</div>`
          : nothing}
        ${group.messages.map(
          (msg) => html`
            <div
              class="bubble ${align}"
              part="bubble bubble-${align}"
              role="article"
              tabindex="0"
              aria-label="${msg.isSystem ? msg.text : `${msg.sender}: ${msg.text}`}"
              @click=${() => this._copyMessage(msg)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') this._copyMessage(msg);
              }}
            >
              <span class="message-text" part="message-text">${this._renderMessageText(msg)}</span>
            </div>
          `,
        )}
        <div class="timestamp" part="timestamp">
          ${formatTimestamp(lastMsg.timestamp, tsFormat)}
        </div>
      </div>
    `;
  }

  private _renderMessageText(msg: ChatMessage): TemplateResult {
    if (msg.mentions.length === 0) {
      return html`${msg.text}`;
    }

    // Render with mention highlighting
    const remaining = msg.text;
    const parts: TemplateResult[] = [];
    const mentionRegex = /@\[([^\]]+)\]|@(\w+)/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = mentionRegex.exec(remaining)) !== null) {
      // Add text before mention
      if (match.index > lastIndex) {
        parts.push(html`${remaining.substring(lastIndex, match.index)}`);
      }
      const mentionName = match[1] || match[2];
      parts.push(html`<span class="mention" part="mention">@${mentionName}</span>`);
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < remaining.length) {
      parts.push(html`${remaining.substring(lastIndex)}`);
    }

    return html`${parts}`;
  }

  private _renderUnreadBadge(): TemplateResult {
    return html`
      <div
        class="unread-badge"
        part="unread-badge"
        @click=${this._scrollToBottomClick}
        role="button"
        tabindex="0"
        aria-label="Scroll to new messages"
      >
        ↓ New messages
      </div>
    `;
  }

  private _renderInputArea(): TemplateResult | typeof nothing {
    if (!this._config.show_input) return nothing;

    const disabled = !this._resolved.entityId || this._sending;
    return html`
      <div class="input-area" part="input-area">
        <textarea
          rows="1"
          placeholder=${this._resolved.entityId
            ? 'Type a message...'
            : 'Select a channel or contact'}
          .value=${this._inputText}
          ?disabled=${disabled}
          @input=${this._onInputChange}
          @keydown=${this._onInputKeydown}
          part="input-textarea"
        ></textarea>
        <button
          class="send-button"
          part="send-button"
          ?disabled=${disabled || !this._inputText.trim()}
          @click=${this._sendMessage}
          aria-label="Send message"
        >
          ${SEND_ICON}
        </button>
      </div>
    `;
  }

  private _renderCopiedToast(): TemplateResult {
    return html`
      <div class="copied-toast ${this._showCopiedToast ? 'visible' : ''}">Copied!</div>
    `;
  }

  // === Event Handlers ===

  private _onScroll(e: Event): void {
    const el = e.target as HTMLElement;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    this._userScrolledUp = !isAtBottom;
    if (isAtBottom) {
      this._hasNewMessages = false;
    }
    this._chatContainer = el;

    // Lazy load: detect scroll near top
    if (
      el.scrollTop < LAZY_LOAD_SCROLL_THRESHOLD &&
      this._store &&
      !this._store.loadingOlder &&
      this._store.hasOlderMessages &&
      this._initialScrollDone
    ) {
      this._store.loadOlderMessages();
    }
  }

  private _scrollToBottom(smooth: boolean): void {
    const el = this._chatContainer ?? this.shadowRoot?.querySelector('.chat-container');
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant',
      });
    }
  }

  private _scrollToBottomClick(): void {
    this._hasNewMessages = false;
    this._userScrolledUp = false;
    this._scrollToBottom(true);
  }

  private _onSearchInput(e: Event): void {
    this._searchQuery = (e.target as HTMLInputElement).value;
  }

  private _filterBySearch(items: RenderItem[]): RenderItem[] {
    const query = this._searchQuery.toLowerCase();
    return items.filter((item) => {
      if (item.type === 'date-separator') return true;
      return item.group.messages.some(
        (msg) => msg.text.toLowerCase().includes(query) || msg.sender.toLowerCase().includes(query),
      );
    });
  }

  private async _copyMessage(msg: ChatMessage): Promise<void> {
    if (msg.isSystem) return;
    try {
      // Try modern Clipboard API first
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(msg.text);
      } else {
        // Fallback for contexts where Clipboard API is unavailable
        this._copyFallback(msg.text);
      }
      this._showCopiedToast = true;
      setTimeout(() => {
        this._showCopiedToast = false;
      }, 1500);
    } catch {
      // Clipboard API denied (e.g. non-secure context, iframe restrictions) — use fallback
      try {
        this._copyFallback(msg.text);
        this._showCopiedToast = true;
        setTimeout(() => {
          this._showCopiedToast = false;
        }, 1500);
      } catch {
        // Truly unavailable
      }
    }
  }

  private _copyFallback(text: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  private _onInputChange(e: Event): void {
    this._inputText = (e.target as HTMLTextAreaElement).value;
  }

  private _onInputKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._sendMessage();
    }
  }

  private async _sendMessage(): Promise<void> {
    const text = this._inputText.trim();
    if (!text || !this.hass || !this._resolved.entityId) return;

    this._sending = true;
    this.requestUpdate();

    try {
      const sendMode = this._config.send_mode ?? 'service';

      if (sendMode === 'service') {
        // Try direct MeshCore service calls first (bypass select entity sync entirely)
        const sent = await this._trySendDirect(text);
        if (!sent) {
          // Fallback: sync select entities then call the configured send_service
          // (for non-meshcore presets or custom send_service configs)
          const service = this._config.send_service;
          if (!service) throw new Error('No send_service configured');

          const [domain, serviceName] = service.split('.');

          await this._syncRecipientSelects();

          if (this._config.send_text_entity) {
            await this.hass.callService('text', 'set_value', {
              entity_id: this._config.send_text_entity,
              value: text,
            });
          }

          await this.hass.callService(domain, serviceName, {
            ...this._config.send_service_data,
          });
        }
      } else if (sendMode === 'entity') {
        // Set text entity value
        if (this._config.send_text_entity) {
          await this.hass.callService('text', 'set_value', {
            entity_id: this._config.send_text_entity,
            value: text,
          });
        }
        // Trigger send button
        if (this._config.send_trigger_entity) {
          const [domain] = this._config.send_trigger_entity.split('.');
          await this.hass.callService(domain, 'press', {
            entity_id: this._config.send_trigger_entity,
          });
        }
      }

      this._inputText = '';

      // Show the sent message immediately via optimistic insert
      // This gives instant visual feedback before the logbook API catches up
      if (this._config.node_name) {
        this._store.addOptimisticMessage(this._config.node_name, text);
        this._onStoreUpdate();
      }

      // Also refresh from the API to get the canonical entry and remove the optimistic one
      // MeshCore may take a few seconds to write the logbook entry after radio transmission
      setTimeout(() => this._store.refresh(), 2000);
      setTimeout(() => this._store.refresh(), 5000);
      setTimeout(() => this._store.refresh(), 10000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ha-logbook-chat] Send failed:', err);
      this._error = `Send failed: ${message}`;
    } finally {
      this._sending = false;
      this.requestUpdate();
    }
  }

  /**
   * Try to send using direct MeshCore service calls that bypass select entities.
   * - Channels: meshcore.send_channel_message with channel_idx + message
   * - Contacts: meshcore.send_message with pubkey_prefix + message
   *
   * Returns true if a direct send was performed, false to fall back to
   * the select-entity-sync approach.
   */
  private async _trySendDirect(text: string): Promise<boolean> {
    if (!this.hass || !this._resolved.entityId || !this._resolved.recipientType) return false;

    // Only use direct calls when using the meshcore preset or meshcore send_service
    const isMeshcore =
      this._config.preset === 'meshcore' ||
      this._config.send_service === 'meshcore.send_ui_message';
    if (!isMeshcore) return false;

    if (this._resolved.recipientType === 'channel') {
      // Extract channel index from entity_id: binary_sensor.*_ch_1_messages → 1
      const chMatch = this._resolved.entityId.match(/_ch_(\d+)_messages$/);
      if (!chMatch) return false;

      const channelIdx = parseInt(chMatch[1], 10);
      console.debug(
        `[ha-logbook-chat] Direct send: meshcore.send_channel_message ch=${channelIdx}`,
      );

      await this.hass.callService('meshcore', 'send_channel_message', {
        channel_idx: channelIdx,
        message: text,
      });
      return true;
    }

    if (this._resolved.recipientType === 'contact') {
      // Extract contact hex prefix from entity_id: binary_sensor.*_ce7a01_messages → ce7a01
      const ctMatch = this._resolved.entityId.match(/_([0-9a-f]{6,})_messages$/i);
      if (!ctMatch) return false;

      const pubkeyPrefix = ctMatch[1];
      console.debug(
        `[ha-logbook-chat] Direct send: meshcore.send_message prefix=${pubkeyPrefix}`,
      );

      await this.hass.callService('meshcore', 'send_message', {
        pubkey_prefix: pubkeyPrefix,
        message: text,
      });
      return true;
    }

    return false;
  }

  /**
   * Sync the HA select entities (recipient_type, channel, contact) to match
   * the card's current resolved view. This ensures send_ui_message targets
   * the correct recipient rather than whatever the select entities happen
   * to be set to externally.
   *
   * Matches by channel index (N) or contact prefix in option strings rather
   * than label comparison, since resolved labels may differ from select options.
   */
  private async _syncRecipientSelects(): Promise<void> {
    if (!this.hass || !this._resolved.recipientType || !this._resolved.entityId) return;

    // Sync recipient type select
    if (this._config.recipient_type_entity) {
      const currentType = this.hass.states[this._config.recipient_type_entity]?.state;
      const targetType = this._resolved.recipientType === 'channel' ? 'Channel' : 'Contact';
      if (currentType !== targetType) {
        await this.hass.callService('select', 'select_option', {
          entity_id: this._config.recipient_type_entity,
          option: targetType,
        });
      }
    }

    // Sync channel or contact select based on the resolved entity ID
    if (this._resolved.recipientType === 'channel' && this._config.channel_entity) {
      // Extract channel index from the resolved entity_id (e.g., binary_sensor.*_ch_1_messages → 1)
      const chMatch = this._resolved.entityId.match(/_ch_(\d+)_messages$/);
      if (chMatch) {
        const targetIdx = parseInt(chMatch[1], 10);
        const channelSelect = this.hass.states[this._config.channel_entity];
        if (channelSelect) {
          // Check if already pointing to the right channel by checking channel_idx attribute
          const currentIdx = channelSelect.attributes['channel_idx'] as number | undefined;
          if (currentIdx !== targetIdx) {
            // Find the option containing "(N)" for the target channel index
            const options = (channelSelect.attributes['options'] as string[]) ?? [];
            const match = options.find((opt) => {
              const m = opt.match(/\((\d+)\)\s*$/);
              return m && parseInt(m[1], 10) === targetIdx;
            });
            if (match) {
              await this.hass.callService('select', 'select_option', {
                entity_id: this._config.channel_entity,
                option: match,
              });
            }
          }
        }
      }
    } else if (this._resolved.recipientType === 'contact' && this._config.contact_entity) {
      // Extract contact prefix from the resolved entity_id (e.g., binary_sensor.*_ce7a01_messages → ce7a01)
      const ctMatch = this._resolved.entityId.match(/_([0-9a-f]{6,})_messages$/i);
      if (ctMatch) {
        const targetPrefix = ctMatch[1];
        const contactSelect = this.hass.states[this._config.contact_entity];
        if (contactSelect) {
          // Check if already pointing to the right contact
          const currentPrefix = contactSelect.attributes['public_key_prefix'] as string | undefined;
          if (!currentPrefix || !currentPrefix.startsWith(targetPrefix)) {
            // Find the option containing the target prefix
            const options = (contactSelect.attributes['options'] as string[]) ?? [];
            const match = options.find((opt) => {
              const m = opt.match(/\(([0-9a-f]{6,})\)\s*$/i);
              return m && m[1].startsWith(targetPrefix);
            });
            if (match) {
              await this.hass.callService('select', 'select_option', {
                entity_id: this._config.contact_entity,
                option: match,
              });
            }
          }
        }
      }
    }
  }

  // Builtin mode handlers
  private _setBuiltinType(type: 'channel' | 'contact'): void {
    this._builtinType = type;
    this._resolveAndFetch();
  }

  private _onChannelSelect(e: Event): void {
    this._builtinSelectedChannel = parseInt((e.target as HTMLSelectElement).value, 10);
    this._resolveAndFetch();
  }

  private _onContactSelect(e: Event): void {
    this._builtinSelectedContact = (e.target as HTMLSelectElement).value;
    this._resolveAndFetch();
  }
}

// Register card with HA
declare global {
  interface HTMLElementTagNameMap {
    [CARD_TAG]: HaLogbookChat;
  }
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string; preview: boolean }>;
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: 'Logbook Chat Card',
  description: 'Renders logbook message history as a modern chat interface',
  preview: true,
});
