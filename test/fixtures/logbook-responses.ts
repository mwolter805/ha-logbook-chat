import type { LogbookEntry } from '../../src/types';

/**
 * Real logbook entries sampled from a live MeshCore HA instance.
 */
export const PUBLIC_CHANNEL_ENTRIES: LogbookEntry[] = [
  // State change entry — should be filtered out
  {
    state: 'Active',
    entity_id: 'binary_sensor.meshcore_1ed4c1_ch_0_messages',
    name: 'MeshCore MattDub (1ed4c1) Public Messages',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T17:55:44.069081+00:00',
  },
  // Standard incoming message
  {
    message: '<Public> Heltec V4 Test: Hello',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T17:55:44.570081+00:00',
  },
  // Message with @mention (bracket syntax)
  {
    message: "<Public> MPMC-A: @[C1] My t1000-e won't send but can receive inside office building",
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T17:56:24.810843+00:00',
  },
  // Standard incoming
  {
    message: '<Public> Hobie: Testing from eagle Rock',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:29:34.567781+00:00',
  },
  // @mention with word syntax and emoji
  {
    message: '<Public> MLV4 Sol-Brn: @[Hobie] copy you from Newbury Park',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:29:59.569313+00:00',
  },
  // Quick follow-up (same sender, should group)
  {
    message: '<Public> Hobie: Awesome. Thank you!',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:30:14.568499+00:00',
  },
  // Emoji-only message
  {
    message: '<Public> MLV4 Sol-Brn: @[Hobie] 👍🏻',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:30:39.569344+00:00',
  },
  // Long message
  {
    message:
      "<Public> Hobie: I'm heading to to lake Isabella today and bringing these things along to see if there's anything reachable out they",
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:31:54.569838+00:00',
  },
  // Sender name with special characters
  {
    message:
      "<Public> Mark - sbmesh.info: @[TrikeRadio579] repeater prefixes don't actually NEED to be unique. It adds some unnecessary congestion, is all.",
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:34:54.571880+00:00',
  },
  // Mention with emoji in name
  {
    message: '<Public> MPMC-A: @[Squid 🦥] You can configure to remove oldest contacts',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:47:39.568779+00:00',
  },
  // Sender with emoji
  {
    message:
      "<Public> Stormlove⛈️: @[TrikeRadio579] don't see lone island. Dupe prefixes ok for non regional repeaters. 2+ byte prefixes coming soon hopefully",
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:57:40.571762+00:00',
  },
  // URL in message
  {
    message:
      '<Public> Stormlove⛈️: https://discord.com/channels/1350515855942881442/1424049467241402531/1450499326940811415',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T19:03:20.569958+00:00',
  },
  // Sender with emoji
  {
    message: '<Public> Raven 🐦\u200d⬛: Good almost afternoon mesh!',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T19:07:11.568245+00:00',
  },
];

export const TEST_CHANNEL_ENTRIES: LogbookEntry[] = [
  {
    message: '<#test> EFT2: T',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T17:57:15.568852+00:00',
  },
  {
    message: '<#test> MeshBud🤖: ack @[EFT2]  | ef,33,95,66 | 4304ms',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T17:57:20.569564+00:00',
  },
  // Multi-line message
  {
    message:
      '<#test> MeshBud🤖: 1C: Waterman0334\n22: W6DOQ - Wilson Re... 📍\n66: CC9 E22 🦜WCMESH 📍',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T18:12:20.569068+00:00',
  },
  {
    message: '<#test> Agent-P 🕶️: @[Bobby] ACK West of Riverside in 4 hops, 97,eb,1c,be',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T19:01:00.568870+00:00',
  },
];

/**
 * Outgoing message example (from node_name "MattDub")
 */
export const OUTGOING_ENTRIES: LogbookEntry[] = [
  {
    message: '<Public> MattDub: Hello world',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T20:00:00.000000+00:00',
  },
  {
    message: 'MattDub: Direct message',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T20:01:00.000000+00:00',
  },
];

/**
 * System/unparseable message
 */
export const SYSTEM_ENTRIES: LogbookEntry[] = [
  {
    message: 'System restarted',
    domain: 'meshcore',
    icon: 'mdi:message-bulleted',
    when: '2026-03-03T20:05:00.000000+00:00',
  },
];

/**
 * Non-meshcore domain entry (should be filtered when domain_filter is set)
 */
export const OTHER_DOMAIN_ENTRIES: LogbookEntry[] = [
  {
    message: 'Some other integration message',
    domain: 'automation',
    when: '2026-03-03T20:10:00.000000+00:00',
  },
];
