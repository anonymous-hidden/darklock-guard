import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSecurityEvent as formatIdsEvent } from '../src/security-log.js';
import { formatSecurityEvent as formatRelayEvent } from '../../dl_rly/src/security-log.js';

test('security log formatters omit sensitive string values', () => {
  const sentinel = 'RIDGELINE_SENTINEL_SECRET_f1be8db5';
  const metadata = {
    token: sentinel,
    message: sentinel,
    profile: sentinel,
    count: 2,
    blocked: true,
  };

  for (const output of [
    formatIdsEvent('IDS_TEST_EVENT', metadata),
    formatRelayEvent('RLY_TEST_EVENT', metadata),
  ]) {
    assert.equal(output.includes(sentinel), false);
    assert.equal(output.includes('token'), false);
    assert.equal(output.includes('message'), false);
    assert.match(output, /"count":2/);
    assert.match(output, /"blocked":true/);
  }
});
