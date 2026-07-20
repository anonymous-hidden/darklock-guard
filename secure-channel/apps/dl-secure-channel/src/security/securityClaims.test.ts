import { describe, expect, it } from 'vitest';
import { getConversationSecurityUi } from './securityClaims';

describe('conversation security claims', () => {
  it('never shows an encryption claim or lock for contained group messaging', () => {
    const display = getConversationSecurityUi('group');

    expect(display).toEqual({ label: 'Group messaging paused', showLock: false });
    expect(display?.label).not.toMatch(/encrypt|e2e|secure/i);
  });

  it('keeps the tested direct-message encryption label', () => {
    expect(getConversationSecurityUi('dm')).toEqual({
      label: 'Encrypted DM',
      showLock: true,
    });
  });
});
