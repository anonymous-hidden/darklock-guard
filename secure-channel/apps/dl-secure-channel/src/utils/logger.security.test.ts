import { describe, expect, it, vi } from 'vitest';
import { createLogger, toSecurityEventCode } from './logger';

describe('renderer security logger', () => {
  it('never includes caller values in the event code', () => {
    const sentinel = 'RIDGELINE_SENTINEL_TOKEN_7f36cdd6';
    expect(toSecurityEventCode('sync', ['request failed', sentinel, { token: sentinel }])).toBe('[SYNC_REQUEST_FAILED]');
  });

  it('does not emit sensitive sentinel arguments', () => {
    const sentinel = 'RIDGELINE_SENTINEL_MESSAGE_13b76c3a';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createLogger('message').error('decrypt failed', sentinel, { body: sentinel });

    expect(JSON.stringify(error.mock.calls)).not.toContain(sentinel);
    expect(error).toHaveBeenCalledWith('[MESSAGE_DECRYPT_FAILED]');
    error.mockRestore();
  });
});
