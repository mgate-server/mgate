import { describe, expect, it } from 'vitest';
import { normalizeQueueEntry } from './QueuePage';
import type { RawQueueEntry } from './QueuePage';

describe('QueuePage Normalization', () => {
  it('correctly maps raw postqueue -j JSON object to normalized format', () => {
    const raw: RawQueueEntry = {
      queue_id: '4hjwcm4NR2z15xH',
      queue_name: 'deferred',
      arrival_time: 1789368301,
      message_size: 475,
      forced_expire: false,
      sender: 'bench@example.com',
      recipients: [
        {
          address: 'q-27749@example.net',
          delay_reason: 'delivery temporarily suspended: connect to mx.example.net[192.0.2.10]:25: No route to host',
        },
      ],
    };

    const normalized = normalizeQueueEntry(raw);

    expect(normalized.id).toBe('4hjwcm4NR2z15xH');
    expect(normalized.queueName).toBe('deferred');
    expect(normalized.sender).toBe('bench@example.com');
    expect(normalized.recipients).toEqual(['q-27749@example.net']);
    expect(normalized.recipientDetails).toHaveLength(1);
    expect(normalized.recipientDetails[0]?.address).toBe('q-27749@example.net');
    expect(normalized.recipientDetails[0]?.reason).toContain('No route to host');
    expect(normalized.sizeBytes).toBe(475);
    expect(normalized.arrivalTime).toBe(1789368301000);
    expect(normalized.reason).toContain('No route to host');
  });

  it('correctly handles hold status and string recipients', () => {
    const raw: RawQueueEntry = {
      queue_id: '4hjwhold123',
      queue_name: 'hold',
      sender: 'admin@example.com',
      recipients: ['user1@example.com', 'user2@example.com'],
      message_size: 1024,
    };

    const normalized = normalizeQueueEntry(raw);

    expect(normalized.id).toBe('4hjwhold123');
    expect(normalized.queueName).toBe('held');
    expect(normalized.sender).toBe('admin@example.com');
    expect(normalized.recipients).toEqual(['user1@example.com', 'user2@example.com']);
    expect(normalized.sizeBytes).toBe(1024);
  });

  it('supports legacy fallback fields (id, status, size_bytes)', () => {
    const raw: RawQueueEntry = {
      id: 'legacy-id-77',
      status: 'active',
      sender: 'test@local',
      recipients: ['rcpt@local'],
      size_bytes: 2048,
      reason: 'Network unreachable',
    };

    const normalized = normalizeQueueEntry(raw);

    expect(normalized.id).toBe('legacy-id-77');
    expect(normalized.queueName).toBe('active');
    expect(normalized.sizeBytes).toBe(2048);
    expect(normalized.reason).toBe('Network unreachable');
  });
});
