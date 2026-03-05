# Logbook Chat Card

A Home Assistant custom Lovelace card that renders logbook message history as a modern chat interface. Designed for mesh radio networks (MeshCore) but works with any HA integration that writes structured messages to the logbook.

[![GitHub Release](https://img.shields.io/github/v/release/mwolter805/ha-logbook-chat?style=flat-square)](https://github.com/mwolter805/ha-logbook-chat/releases)
[![License](https://img.shields.io/github/license/mwolter805/ha-logbook-chat?style=flat-square)](LICENSE)
[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg?style=flat-square)](https://hacs.xyz)

## Features

- Chat bubble layout with outgoing (right) and incoming (left) alignment
- Sender identification and message grouping
- Date separators between different days
- @mention highlighting
- Click-to-copy messages
- Real-time updates via WebSocket with polling fallback
- Local caching for instant loads
- Message search/filter
- Optional message sending input
- Full HA theme integration
- card-mod compatible with exposed CSS parts
- Accessibility: keyboard navigation, screen reader support, WCAG AA contrast

## Installation

### HACS (Recommended)

1. Open HACS in your Home Assistant instance
2. Go to **Frontend** > **Custom Repositories**
3. Add `https://github.com/mwolter805/ha-logbook-chat` with category **Dashboard**
4. Click **Install**
5. Restart Home Assistant

### Manual

1. Download `ha-logbook-chat.js` from the [latest release](https://github.com/mwolter805/ha-logbook-chat/releases)
2. Copy to `/config/www/ha-logbook-chat.js`
3. Add resource in **Settings** > **Dashboards** > **Resources**:
   - URL: `/local/ha-logbook-chat.js`
   - Type: JavaScript Module

## Quick Start (MeshCore)

```yaml
type: custom:ha-logbook-chat
node_name: MattDub
node_prefix: 1ed4c1
preset: meshcore
```

That's it! The MeshCore preset auto-configures entity patterns, send services, and domain filtering.

## Configuration

### Minimal (Generic)

```yaml
type: custom:ha-logbook-chat
node_name: MyNode
mode: static
entity: binary_sensor.my_messages
```

### Full Reference

```yaml
type: custom:ha-logbook-chat

# === Identity ===
node_name: "MattDub"           # Required. Your name for outgoing detection
node_prefix: "1ed4c1"          # Node prefix for entity pattern matching
preset: meshcore               # Named preset (auto-configures MeshCore defaults)

# === Entity Selection Mode ===
mode: external                 # "external" | "builtin" | "static"

# --- External mode entities (overrides preset) ---
recipient_type_entity: select.meshcore_recipient_type
channel_entity: select.meshcore_channel
contact_entity: select.meshcore_contact

# --- Static mode ---
# entity: binary_sensor.meshcore_1ed4c1_ch_0_messages

# === Display ===
title: ""                      # Optional card title
hours_to_show: 48              # Hours of history (default: 48)
max_messages: 500              # Max messages to display (default: 500)
show_search: false             # Show search/filter bar (default: false)
show_date_separators: true     # Date dividers between days (default: true)
group_messages: true           # Group consecutive same-sender (default: true)
group_timeout: 300             # Seconds before group breaks (default: 300)
timestamp_format: relative     # "relative" | "time" | "datetime"
max_height: "400px"            # Chat area max height
bubble_max_width: "85%"        # Max bubble width

# === Message Input ===
show_input: false              # Show send message input
send_mode: service             # "service" | "entity"
send_service: meshcore.send_ui_message
send_text_entity: text.meshcore_message

# === Real-Time ===
update_mode: auto              # "auto" | "websocket" | "polling"
refresh_interval: 30           # Polling interval in seconds

# === Cache ===
enable_cache: true             # Use localStorage cache
cache_ttl: 86400               # Cache TTL in seconds (24h)
cache_max_size: 5242880        # Max cache size in bytes (5MB)
```

### Entity Selection Modes

| Mode | Description |
|------|-------------|
| `external` | Watches existing HA select entities (default for MeshCore) |
| `builtin` | Card renders its own channel/contact selector UI |
| `static` | Single entity, no switching |

### MeshCore with Send Input

```yaml
type: custom:ha-logbook-chat
node_name: MattDub
node_prefix: 1ed4c1
preset: meshcore
show_input: true
title: MeshCore Chat
```

## Theming

The card uses HA theme variables automatically and exposes custom CSS properties:

```css
--chat-card-bg
--chat-card-bubble-incoming-bg
--chat-card-bubble-outgoing-bg
--chat-card-bubble-incoming-text
--chat-card-bubble-outgoing-text
--chat-card-sender-color
--chat-card-timestamp-color
--chat-card-mention-bg
--chat-card-mention-text
--chat-card-date-separator-color
--chat-card-unread-badge-bg
--chat-card-input-bg
--chat-card-input-border
--chat-card-scrollbar-thumb
--chat-card-max-height
```

### card-mod Example

```yaml
type: custom:ha-logbook-chat
node_name: MattDub
preset: meshcore
card_mod:
  style: |
    .chat-container { max-height: 600px; }
    .bubble.outgoing { background: #1a73e8; }
```

Exposed CSS parts: `chat-container`, `bubble`, `bubble-incoming`, `bubble-outgoing`, `sender`, `message-text`, `timestamp`, `date-separator`, `search-bar`, `input-area`, `send-button`, `unread-badge`, `mention`, `header`, `empty-state`, `error-state`.

## Development

```bash
git clone https://github.com/mwolter805/ha-logbook-chat.git
cd ha-logbook-chat
npm install
npm run dev     # Watch mode
npm test        # Run unit tests
npm run build   # Production build
npm run lint    # Check linting
```

## License

MIT
