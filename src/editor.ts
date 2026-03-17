import { LitElement, html, css, type TemplateResult, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { CardConfig, HomeAssistant } from './types';
import { EDITOR_TAG, PRESETS, DEFAULT_CONFIG } from './constants';

@customElement(EDITOR_TAG)
export class HaLogbookChatEditor extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _config!: CardConfig;

  static styles = css`
    :host {
      display: block;
    }
    .section {
      margin-bottom: 16px;
    }
    .section-title {
      font-weight: 500;
      font-size: 14px;
      margin-bottom: 8px;
      color: var(--primary-text-color);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .row label {
      flex: 1;
      font-size: 14px;
      color: var(--primary-text-color);
    }
    .row input,
    .row select {
      flex: 1;
      padding: 8px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 4px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font-size: 14px;
    }
    .row input[type='checkbox'] {
      flex: none;
      width: 18px;
      height: 18px;
    }
    .row input[type='number'] {
      max-width: 100px;
    }
    .hint {
      font-size: 12px;
      color: var(--secondary-text-color);
      margin-top: -4px;
      margin-bottom: 8px;
    }
  `;

  setConfig(config: CardConfig): void {
    this._config = { ...config };
  }

  protected render(): TemplateResult {
    if (!this._config) return html``;

    return html`
      <div class="section">
        <div class="section-title">Preset</div>
        <div class="row">
          <label>Integration Preset</label>
          <select .value=${this._config.preset ?? ''} @change=${this._onPresetChange}>
            <option value="">Generic (no preset)</option>
            ${Object.entries(PRESETS).map(
              ([key, preset]) =>
                html`<option value=${key} ?selected=${this._config.preset === key}>
                  ${preset.name}
                </option>`,
            )}
          </select>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Identity</div>
        <div class="row">
          <label>Node Name *</label>
          <input
            type="text"
            .value=${this._config.node_name ?? ''}
            @input=${(e: Event) =>
              this._updateConfig('node_name', (e.target as HTMLInputElement).value)}
            placeholder="e.g., MattDub"
          />
        </div>
        <div class="row">
          <label>Node Prefix</label>
          <input
            type="text"
            .value=${this._config.node_prefix ?? ''}
            @input=${(e: Event) =>
              this._updateConfig('node_prefix', (e.target as HTMLInputElement).value)}
            placeholder="e.g., 1ed4c1"
          />
        </div>
        <div class="hint">First 6 hex characters of your public key</div>
      </div>

      <div class="section">
        <div class="section-title">Entity Mode</div>
        <div class="row">
          <label>Selection Mode</label>
          <select
            .value=${this._config.mode ?? 'external'}
            @change=${(e: Event) =>
              this._updateConfig('mode', (e.target as HTMLSelectElement).value)}
          >
            <option value="external">External (watch select entities)</option>
            <option value="builtin">Built-in (card-managed selector)</option>
            <option value="static">Static (single entity)</option>
          </select>
        </div>
        ${this._config.mode === 'static'
          ? html`
              <div class="row">
                <label>Entity *</label>
                <input
                  type="text"
                  .value=${this._config.entity ?? ''}
                  @input=${(e: Event) =>
                    this._updateConfig('entity', (e.target as HTMLInputElement).value)}
                  placeholder="binary_sensor.meshcore_..."
                />
              </div>
            `
          : nothing}
      </div>

      <div class="section">
        <div class="section-title">Display</div>
        <div class="row">
          <label>Title</label>
          <input
            type="text"
            .value=${this._config.title ?? ''}
            @input=${(e: Event) =>
              this._updateConfig('title', (e.target as HTMLInputElement).value)}
            placeholder="Optional card title"
          />
        </div>
        <div class="row">
          <label>Hours of History</label>
          <input
            type="number"
            .value=${String(this._config.hours_to_show ?? DEFAULT_CONFIG.hours_to_show)}
            @input=${(e: Event) =>
              this._updateConfig(
                'hours_to_show',
                parseInt((e.target as HTMLInputElement).value, 10),
              )}
            min="1"
            max="720"
          />
        </div>
        <div class="row">
          <label>Initial Load Hours</label>
          <input
            type="number"
            .value=${String(this._config.initial_hours ?? DEFAULT_CONFIG.initial_hours)}
            @input=${(e: Event) =>
              this._updateConfig(
                'initial_hours',
                parseInt((e.target as HTMLInputElement).value, 10),
              )}
            min="1"
            max="48"
          />
        </div>
        <div class="hint">Hours to fetch on first load (expands to 3x then 6x if needed, scroll for more)</div>
        <div class="row">
          <label>Max Messages</label>
          <input
            type="number"
            .value=${String(this._config.max_messages ?? DEFAULT_CONFIG.max_messages)}
            @input=${(e: Event) =>
              this._updateConfig(
                'max_messages',
                parseInt((e.target as HTMLInputElement).value, 10),
              )}
            min="10"
            max="5000"
          />
        </div>
        <div class="row">
          <label>Max Height</label>
          <input
            type="text"
            .value=${this._config.max_height ?? DEFAULT_CONFIG.max_height}
            @input=${(e: Event) =>
              this._updateConfig('max_height', (e.target as HTMLInputElement).value)}
            placeholder="e.g., 400px"
          />
        </div>
        <div class="row">
          <label>Timestamp Format</label>
          <select
            .value=${this._config.timestamp_format ?? 'relative'}
            @change=${(e: Event) =>
              this._updateConfig('timestamp_format', (e.target as HTMLSelectElement).value)}
          >
            <option value="relative">Relative (5m ago)</option>
            <option value="time">Time (2:30 PM)</option>
            <option value="datetime">Date + Time</option>
          </select>
        </div>
        <div class="row">
          <label>Show Search</label>
          <input
            type="checkbox"
            ?checked=${this._config.show_search ?? false}
            @change=${(e: Event) =>
              this._updateConfig('show_search', (e.target as HTMLInputElement).checked)}
          />
        </div>
        <div class="row">
          <label>Show Date Separators</label>
          <input
            type="checkbox"
            ?checked=${this._config.show_date_separators ?? true}
            @change=${(e: Event) =>
              this._updateConfig('show_date_separators', (e.target as HTMLInputElement).checked)}
          />
        </div>
        <div class="row">
          <label>Group Messages</label>
          <input
            type="checkbox"
            ?checked=${this._config.group_messages ?? true}
            @change=${(e: Event) =>
              this._updateConfig('group_messages', (e.target as HTMLInputElement).checked)}
          />
        </div>
        <div class="row">
          <label>Smooth Scroll</label>
          <input
            type="checkbox"
            ?checked=${this._config.smooth_scroll ?? false}
            @change=${(e: Event) =>
              this._updateConfig('smooth_scroll', (e.target as HTMLInputElement).checked)}
          />
        </div>
        <div class="hint">Enable smooth scroll animations (may cause issues on iOS)</div>
      </div>

      <div class="section">
        <div class="section-title">Message Input</div>
        <div class="row">
          <label>Show Send Input</label>
          <input
            type="checkbox"
            ?checked=${this._config.show_input ?? false}
            @change=${(e: Event) =>
              this._updateConfig('show_input', (e.target as HTMLInputElement).checked)}
          />
        </div>
      </div>
    `;
  }

  private _onPresetChange(e: Event): void {
    const preset = (e.target as HTMLSelectElement).value || undefined;
    this._updateConfig('preset', preset);
  }

  private _updateConfig(key: string, value: unknown): void {
    if (value === '' || value === undefined) {
      const newConfig = { ...this._config };
      delete (newConfig as Record<string, unknown>)[key];
      this._config = newConfig as CardConfig;
    } else {
      this._config = { ...this._config, [key]: value };
    }

    const event = new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [EDITOR_TAG]: HaLogbookChatEditor;
  }
}
