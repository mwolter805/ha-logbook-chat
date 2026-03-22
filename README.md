# Logbook Chat Card

A Home Assistant custom Lovelace card that renders logbook message history as a modern chat interface. Designed for mesh radio networks (MeshCore) but works with any HA integration that writes structured messages to the logbook.

[![GitHub Release](https://img.shields.io/github/v/release/mwolter805/ha-logbook-chat?style=flat-square)](https://github.com/mwolter805/ha-logbook-chat/releases)
[![License](https://img.shields.io/github/license/mwolter805/ha-logbook-chat?style=flat-square)](LICENSE)
[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg?style=flat-square)](https://hacs.xyz)

## Screenshots

| Light Theme | Dark Theme |
|:-----------:|:----------:|
| ![Light Theme](screenshots/ha-logbook-chat%20light.jpg) | ![Dark Theme](screenshots/ha-logbook-chat%20dark.jpg) |

## Features

- Chat bubble layout with outgoing (right) and incoming (left) alignment
- Sender identification and automatic message grouping
- Date separators between different days
- @mention highlighting with contrast-aware colors for outgoing bubbles
- Message tap/click action menu with Reply, Copy, and Route display
- Reply prepopulates input with `@[SenderName]` mention
- MeshCore route tag parsing and display (`[route:xx,xx,...]`)
- Smart contact and channel discovery from `select` entities (no message history required)
- Lazy loading with time-window expansion and scroll-triggered older message fetching
- Real-time updates via WebSocket with polling fallback
- Local caching for instant loads
- Message search/filter
- Optional message sending input with direct and service-based send modes
- Full HA theme integration (light and dark)
- card-mod compatible with exposed CSS parts
- Tracked timer cleanup to prevent memory leaks on long sessions
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

That's it! The MeshCore preset auto-configures entity patterns, send services, contact/channel discovery, and domain filtering.

## Configuration

### Minimal (Generic)

```yaml
type: custom:ha-logbook-chat
node_name: MyNode
mode: static
entity: binary_sensor.my_messages
```

### MeshCore with Send Input

```yaml
type: custom:ha-logbook-chat
node_name: MattDub
node_prefix: 1ed4c1
preset: meshcore
show_input: true
title: MeshCore Chat
```

### Full Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `node_name` | string | *required* | Your name for outgoing message detection |
| `node_prefix` | string | | Node prefix for entity pattern matching |
| `preset` | string | | Named preset (`meshcore`) — auto-configures defaults |
| `mode` | string | `external` | Entity selection: `external`, `builtin`, or `static` |
| `entity` | string | | Entity ID for `static` mode |
| `recipient_type_entity` | string | | Select entity for recipient type (external mode) |
| `channel_entity` | string | | Select entity for channel switching (external mode) |
| `contact_entity` | string | | Select entity for contact switching (external mode) |
| `channel_entity_pattern` | string | | Pattern template for channel entities |
| `contact_entity_pattern` | string | | Pattern template for contact entities |
| `domain_filter` | string | | Filter logbook entries to this domain |
| `title` | string | | Optional card title |
| `hours_to_show` | number | `48` | Maximum hours of history to fetch |
| `initial_hours` | number | `1` | Initial time window for fast first paint |
| `max_messages` | number | `500` | Max messages to display |
| `show_search` | boolean | `false` | Show search/filter bar |
| `show_date_separators` | boolean | `true` | Show date dividers between days |
| `group_messages` | boolean | `true` | Group consecutive same-sender messages |
| `group_timeout` | number | `300` | Seconds before same-sender group breaks |
| `timestamp_format` | string | `relative` | `relative`, `time`, or `datetime` |
| `max_height` | string | `400px` | Chat area max height |
| `bubble_max_width` | string | `85%` | Max bubble width |
| `smooth_scroll` | boolean | `false` | Enable smooth scroll animations |
| `show_input` | boolean | `false` | Show message send input |
| `send_mode` | string | `service` | `service` or `entity` |
| `send_service` | string | | Service to call (service mode) |
| `send_service_data` | object | | Additional service call data |
| `send_text_entity` | string | | Text entity for message content |
| `send_trigger_entity` | string | | Button entity to trigger send |
| `update_mode` | string | `auto` | `auto`, `websocket`, or `polling` |
| `refresh_interval` | number | `10` | Polling interval in seconds |
| `event_type` | string | | Custom event type to subscribe to |
| `enable_cache` | boolean | `true` | Use localStorage cache |
| `cache_ttl` | number | `86400` | Cache TTL in seconds (24h) |
| `cache_max_size` | number | `5242880` | Max cache size in bytes (5MB) |

### Entity Selection Modes

| Mode | Description |
|------|-------------|
| `external` | Watches existing HA select entities for channel/contact switching (default for MeshCore) |
| `builtin` | Card renders its own channel/contact selector UI with auto-discovery |
| `static` | Single entity, no switching |

### Contact & Channel Discovery

In `external` and `builtin` modes, the card discovers available contacts and channels in two ways:

1. **Select-based discovery** (preferred): Reads options from `select.meshcore_contact` and `select.meshcore_channel` entities. This works immediately for all saved contacts, even those with no message history yet.
2. **Legacy entity scanning**: Falls back to scanning for `binary_sensor.meshcore_*_messages` entities in Home Assistant's state registry.

This solves the chicken-and-egg problem where new contacts were invisible until they had message history.

### Message Actions

Tapping or clicking a message opens an action dialog with:

- **Reply** — prepopulates the input field with `@[SenderName]` and focuses the textarea
- **Copy** — copies the message text to the clipboard
- **Route** — displays the MeshCore relay route (hop path) if available

### Lazy Loading

The card uses time-window based lazy loading for fast initial renders:

1. Fetches a small initial time window (`initial_hours`, default 1 hour)
2. Adaptively expands the window if fewer than 20 messages are found
3. When you scroll to the top, automatically fetches the next batch of older messages
4. Scroll position is preserved when older messages are prepended

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
