import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetDraftReply, recallDraftReply, rememberDraftReply } from './draftReply';

describe('draftReply', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('remembers the replied-to message under the new draft id and drops the old one', () => {
    rememberDraftReply('drafts.1.1', 'inbox.1.5');
    expect(recallDraftReply('drafts.1.1')).toBe('inbox.1.5');

    rememberDraftReply('drafts.1.2', 'inbox.1.5', 'drafts.1.1');
    expect(recallDraftReply('drafts.1.1')).toBeUndefined();
    expect(recallDraftReply('drafts.1.2')).toBe('inbox.1.5');
  });

  it('forgets an entry (sent or discarded drafts)', () => {
    rememberDraftReply('drafts.1.1', 'inbox.1.5');
    forgetDraftReply('drafts.1.1');
    forgetDraftReply(undefined);
    expect(recallDraftReply('drafts.1.1')).toBeUndefined();
  });

  it('keeps only the newest entries', () => {
    for (let i = 0; i < 60; i++) rememberDraftReply(`drafts.1.${i}`, `inbox.1.${i}`);
    expect(recallDraftReply('drafts.1.0')).toBeUndefined();
    expect(recallDraftReply('drafts.1.59')).toBe('inbox.1.59');
  });

  it('ignores corrupt storage and survives unavailable storage', () => {
    window.localStorage.setItem('mgate.mail.draftReplies', '{not json');
    expect(recallDraftReply('drafts.1.1')).toBeUndefined();
    window.localStorage.setItem('mgate.mail.draftReplies', '["x"]');
    expect(recallDraftReply('drafts.1.1')).toBeUndefined();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberDraftReply('drafts.1.1', 'inbox.1.5')).not.toThrow();
    expect(recallDraftReply('drafts.1.1')).toBeUndefined();
  });
});
