import { createHash, randomBytes } from 'crypto';

export interface OAuthAttempt {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createCodeVerifier(): string {
  // 64 random bytes => 86-char base64url (within RFC 7636's 43-128 range).
  return toBase64Url(randomBytes(64));
}

function createCodeChallengeS256(codeVerifier: string): string {
  return toBase64Url(createHash('sha256').update(codeVerifier).digest());
}

export function createOAuthAttempt(): OAuthAttempt {
  const codeVerifier = createCodeVerifier();
  const state = toBase64Url(randomBytes(32));
  return {
    state,
    codeVerifier,
    codeChallenge: createCodeChallengeS256(codeVerifier),
    codeChallengeMethod: 'S256',
  };
}

export function buildPkceTokenBody(opts: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
}): string {
  if (!opts.codeVerifier) {
    throw new Error('missing_code_verifier');
  }

  const params = new URLSearchParams({
    client_id: opts.clientId,
    code: opts.code,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });

  if (opts.scope) {
    params.set('scope', opts.scope);
  }

  return params.toString();
}

export function validateOAuthRedirect(
  currentUrl: string,
  redirectUri: string,
  expectedState: string,
): { matched: false } | { matched: true; code: string } {
  const parsed = new URL(currentUrl);
  const expected = new URL(redirectUri);

  if (parsed.origin !== expected.origin) {
    return { matched: false };
  }

  // Exact callback pathname match only (prevents prefix tricks like /callback-evil).
  if (parsed.pathname !== expected.pathname) {
    throw new Error('redirect_mismatch');
  }

  const state = parsed.searchParams.get('state');
  if (!state) {
    throw new Error('missing_state');
  }
  if (state !== expectedState) {
    throw new Error('invalid_state');
  }

  const error = parsed.searchParams.get('error');
  if (error) {
    throw new Error(error);
  }

  const code = parsed.searchParams.get('code');
  if (!code) {
    throw new Error('no_code');
  }

  return { matched: true, code };
}
