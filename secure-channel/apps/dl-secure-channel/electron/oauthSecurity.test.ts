import { describe, expect, it } from 'vitest';
import { buildPkceTokenBody, validateOAuthRedirect } from './oauthSecurity';

describe('desktop OAuth security checks', () => {
  const redirectUri = 'https://127.0.0.1/dl-oauth/discord';
  const expectedState = 'expected-state-token';

  it('rejects callback with missing state', () => {
    expect(() =>
      validateOAuthRedirect(
        `${redirectUri}?code=abc123`,
        redirectUri,
        expectedState,
      ),
    ).toThrowError('missing_state');
  });

  it('rejects callback with wrong state', () => {
    expect(() =>
      validateOAuthRedirect(
        `${redirectUri}?code=abc123&state=wrong-state`,
        redirectUri,
        expectedState,
      ),
    ).toThrowError('invalid_state');
  });

  it('rejects token exchange when code_verifier is missing', () => {
    expect(() =>
      buildPkceTokenBody({
        clientId: 'client-id',
        code: 'auth-code',
        redirectUri,
        codeVerifier: '',
      }),
    ).toThrowError('missing_code_verifier');
  });

  it('rejects malicious prefix redirect path', () => {
    expect(() =>
      validateOAuthRedirect(
        'https://127.0.0.1/dl-oauth/discord-evil?code=abc123&state=expected-state-token',
        redirectUri,
        expectedState,
      ),
    ).toThrowError('redirect_mismatch');
  });
});
