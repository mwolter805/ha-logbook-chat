import { describe, it, expect } from 'vitest';
import {
  parseLogbookEntry,
  parseLogbookEntries,
  extractMentions,
  groupMessages,
  buildRenderItems,
  formatDateSeparator,
  formatTimestamp,
} from '../src/message-parser';
import type { LogbookEntry } from '../src/types';
import {
  PUBLIC_CHANNEL_ENTRIES,
  TEST_CHANNEL_ENTRIES,
  OUTGOING_ENTRIES,
  SYSTEM_ENTRIES,
  OTHER_DOMAIN_ENTRIES,
} from './fixtures/logbook-responses';

const CONFIG = { node_name: 'MattDub', domain_filter: 'meshcore' };

describe('parseLogbookEntry', () => {
  it('filters out state change entries', () => {
    const entry: LogbookEntry = {
      state: 'Active',
      entity_id: 'binary_sensor.meshcore_1ed4c1_ch_0_messages',
      name: 'Public Messages',
      when: '2026-03-03T17:55:44.069081+00:00',
    };
    expect(parseLogbookEntry(entry, CONFIG)).toBeNull();
  });

  it('filters out entries with no message field', () => {
    const entry: LogbookEntry = {
      when: '2026-03-03T17:55:44.069081+00:00',
    };
    expect(parseLogbookEntry(entry, CONFIG)).toBeNull();
  });

  it('filters out entries with wrong domain when domain_filter is set', () => {
    const result = parseLogbookEntry(OTHER_DOMAIN_ENTRIES[0], CONFIG);
    expect(result).toBeNull();
  });

  it('parses standard channel message with <Public> prefix', () => {
    const result = parseLogbookEntry(
      {
        message: '<Public> Heltec V4 Test: Hello',
        domain: 'meshcore',
        when: '2026-03-03T17:55:44.570081+00:00',
      },
      CONFIG,
    );
    expect(result).not.toBeNull();
    expect(result!.sender).toBe('Heltec V4 Test');
    expect(result!.text).toBe('Hello');
    expect(result!.isOutgoing).toBe(false);
    expect(result!.isSystem).toBe(false);
  });

  it('parses outgoing message (sender matches node_name)', () => {
    const result = parseLogbookEntry(OUTGOING_ENTRIES[0], CONFIG);
    expect(result).not.toBeNull();
    expect(result!.sender).toBe('MattDub');
    expect(result!.text).toBe('Hello world');
    expect(result!.isOutgoing).toBe(true);
  });

  it('parses direct message without channel prefix', () => {
    const result = parseLogbookEntry(OUTGOING_ENTRIES[1], CONFIG);
    expect(result).not.toBeNull();
    expect(result!.sender).toBe('MattDub');
    expect(result!.text).toBe('Direct message');
    expect(result!.isOutgoing).toBe(true);
  });

  it('parses #test channel prefix', () => {
    const result = parseLogbookEntry(TEST_CHANNEL_ENTRIES[0], CONFIG);
    expect(result).not.toBeNull();
    expect(result!.sender).toBe('EFT2');
    expect(result!.text).toBe('T');
  });

  it('parses system message (no sender:text pattern)', () => {
    const result = parseLogbookEntry(SYSTEM_ENTRIES[0], CONFIG);
    expect(result).not.toBeNull();
    expect(result!.isSystem).toBe(true);
    expect(result!.text).toBe('System restarted');
    expect(result!.sender).toBe('');
  });

  it('handles sender name with special characters (Mark - sbmesh.info)', () => {
    const entry: LogbookEntry = {
      message: '<Public> Mark - sbmesh.info: @[TrikeRadio579] prefixes...',
      domain: 'meshcore',
      when: '2026-03-03T18:34:54.571880+00:00',
    };
    const result = parseLogbookEntry(entry, CONFIG);
    expect(result).not.toBeNull();
    expect(result!.sender).toBe('Mark - sbmesh.info');
    expect(result!.text).toBe('@[TrikeRadio579] prefixes...');
  });

  it('handles sender name with emoji (Stormlove⛈️)', () => {
    const result = parseLogbookEntry(PUBLIC_CHANNEL_ENTRIES[10], CONFIG);
    expect(result).not.toBeNull();
    expect(result!.sender).toBe('Stormlove⛈️');
  });

  it('handles multi-line messages', () => {
    const result = parseLogbookEntry(TEST_CHANNEL_ENTRIES[2], CONFIG);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('\n');
    expect(result!.sender).toBe('MeshBud🤖');
  });

  it('extracts @[Name] mentions', () => {
    const result = parseLogbookEntry(PUBLIC_CHANNEL_ENTRIES[9], CONFIG);
    expect(result).not.toBeNull();
    expect(result!.mentions).toContain('Squid 🦥');
  });

  it('passes through entries with no domain_filter set', () => {
    const configNoDomain = { node_name: 'MattDub', domain_filter: undefined };
    const result = parseLogbookEntry(OTHER_DOMAIN_ENTRIES[0], configNoDomain);
    expect(result).not.toBeNull();
  });
});

describe('extractMentions', () => {
  it('extracts bracket mentions @[Name]', () => {
    expect(extractMentions('@[Squid 🦥] hello')).toEqual(['Squid 🦥']);
  });

  it('extracts word mentions @Name', () => {
    expect(extractMentions('hello @Bobby')).toEqual(['Bobby']);
  });

  it('extracts multiple mentions', () => {
    const mentions = extractMentions('@[Alice] and @Bob and @[Charlie]');
    // Bracket mentions extracted first pass, then word mentions second pass
    expect(mentions).toEqual(['Alice', 'Charlie', 'Bob']);
  });

  it('deduplicates mentions', () => {
    const mentions = extractMentions('@[Bob] hello @Bob');
    // @[Bob] captured first, @Bob would match "Bob" again but is deduped
    expect(mentions).toEqual(['Bob']);
  });

  it('returns empty array for no mentions', () => {
    expect(extractMentions('Hello world')).toEqual([]);
  });
});

describe('parseLogbookEntries', () => {
  it('filters and parses a batch of entries', () => {
    const messages = parseLogbookEntries(PUBLIC_CHANNEL_ENTRIES, CONFIG);
    // First entry is a state change, should be filtered out
    expect(messages.length).toBe(PUBLIC_CHANNEL_ENTRIES.length - 1);
    expect(messages[0].sender).toBe('Heltec V4 Test');
  });
});

describe('groupMessages', () => {
  it('groups consecutive messages from the same sender', () => {
    // Use controlled entries where Hobie sends 3 consecutive messages
    const entries: LogbookEntry[] = [
      {
        message: '<Public> Hobie: Message 1',
        domain: 'meshcore',
        when: '2026-03-03T18:29:00.000000+00:00',
      },
      {
        message: '<Public> Hobie: Message 2',
        domain: 'meshcore',
        when: '2026-03-03T18:30:00.000000+00:00',
      },
      {
        message: '<Public> Hobie: Message 3',
        domain: 'meshcore',
        when: '2026-03-03T18:31:00.000000+00:00',
      },
    ];
    const messages = parseLogbookEntries(entries, CONFIG);
    const groups = groupMessages(messages, 300);
    expect(groups.length).toBe(1);
    expect(groups[0].messages.length).toBe(3);
    expect(groups[0].sender).toBe('Hobie');
  });

  it('breaks groups after timeout', () => {
    const messages = parseLogbookEntries(PUBLIC_CHANNEL_ENTRIES, CONFIG);
    // Use 1 second timeout — each message should be its own group
    const groups = groupMessages(messages, 1);
    expect(groups.length).toBe(messages.length);
  });

  it('returns empty array for empty input', () => {
    expect(groupMessages([], 300)).toEqual([]);
  });

  it('system messages are always their own group', () => {
    const sysMessages = parseLogbookEntries(SYSTEM_ENTRIES, CONFIG);
    const regular = parseLogbookEntries(
      [{ message: 'Test: before', domain: 'meshcore', when: '2026-03-03T20:04:59.000000+00:00' }],
      CONFIG,
    );
    const combined = [...regular, ...sysMessages];
    const groups = groupMessages(combined, 300);
    expect(groups.length).toBe(2);
    expect(groups[1].isSystem).toBe(true);
  });
});

describe('buildRenderItems', () => {
  it('inserts date separators between different days', () => {
    const entries: LogbookEntry[] = [
      { message: '<Public> A: Day1', domain: 'meshcore', when: '2026-03-03T10:00:00.000000+00:00' },
      { message: '<Public> B: Day2', domain: 'meshcore', when: '2026-03-04T10:00:00.000000+00:00' },
    ];
    const messages = parseLogbookEntries(entries, CONFIG);
    const items = buildRenderItems(messages, {
      group_messages: true,
      group_timeout: 300,
      show_date_separators: true,
    });
    // Should have: date-sep, group, date-sep, group
    expect(items.length).toBe(4);
    expect(items[0].type).toBe('date-separator');
    expect(items[1].type).toBe('group');
    expect(items[2].type).toBe('date-separator');
    expect(items[3].type).toBe('group');
  });

  it('skips date separators when disabled', () => {
    const entries: LogbookEntry[] = [
      { message: '<Public> A: Day1', domain: 'meshcore', when: '2026-03-03T10:00:00.000000+00:00' },
      { message: '<Public> B: Day2', domain: 'meshcore', when: '2026-03-04T10:00:00.000000+00:00' },
    ];
    const messages = parseLogbookEntries(entries, CONFIG);
    const items = buildRenderItems(messages, {
      group_messages: true,
      group_timeout: 300,
      show_date_separators: false,
    });
    expect(items.every((i) => i.type === 'group')).toBe(true);
  });
});

describe('formatDateSeparator', () => {
  it('returns "Today" for current date', () => {
    expect(formatDateSeparator(new Date())).toBe('Today');
  });

  it('returns "Yesterday" for previous day', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatDateSeparator(yesterday)).toBe('Yesterday');
  });
});

describe('formatTimestamp', () => {
  it('returns "now" for very recent timestamps in relative mode', () => {
    const now = new Date();
    expect(formatTimestamp(now, 'relative')).toBe('now');
  });

  it('returns minutes ago for recent timestamps', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatTimestamp(fiveMinAgo, 'relative')).toBe('5m ago');
  });

  it('returns time string for time format', () => {
    const date = new Date('2026-03-03T14:30:00');
    const result = formatTimestamp(date, 'time');
    // Should contain hour and minute
    expect(result).toMatch(/\d/);
  });
});
