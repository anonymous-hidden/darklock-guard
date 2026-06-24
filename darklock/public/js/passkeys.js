(function(global) {
    'use strict';

    function getCookie(name) {
        const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : '';
    }

    function toBase64Url(uint8Array) {
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
    }

    function fromBase64Url(base64url) {
        if (!base64url || typeof base64url !== 'string') {
            return new Uint8Array();
        }

        let base64 = base64url
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        const pad = base64.length % 4;
        if (pad) {
            base64 += '='.repeat(4 - pad);
        }

        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function encodeBuffer(value) {
        if (!value) {
            return null;
        }

        if (value instanceof ArrayBuffer) {
            return toBase64Url(new Uint8Array(value));
        }

        if (ArrayBuffer.isView(value)) {
            return toBase64Url(new Uint8Array(value.buffer));
        }

        return null;
    }

    function serializeRegistrationCredential(credential) {
        const response = credential.response;
        return {
            id: credential.id,
            rawId: encodeBuffer(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: encodeBuffer(response.clientDataJSON),
                attestationObject: encodeBuffer(response.attestationObject),
                transports: typeof response.getTransports === 'function' ? response.getTransports() : undefined
            },
            clientExtensionResults: typeof credential.getClientExtensionResults === 'function'
                ? credential.getClientExtensionResults()
                : {},
            authenticatorAttachment: credential.authenticatorAttachment || undefined
        };
    }

    function serializeAuthenticationCredential(credential) {
        const response = credential.response;
        return {
            id: credential.id,
            rawId: encodeBuffer(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: encodeBuffer(response.clientDataJSON),
                authenticatorData: encodeBuffer(response.authenticatorData),
                signature: encodeBuffer(response.signature),
                userHandle: encodeBuffer(response.userHandle)
            },
            clientExtensionResults: typeof credential.getClientExtensionResults === 'function'
                ? credential.getClientExtensionResults()
                : {},
            authenticatorAttachment: credential.authenticatorAttachment || undefined
        };
    }

    function normalizeCreationOptions(options) {
        const normalized = { ...options };
        normalized.challenge = fromBase64Url(options.challenge);

        normalized.user = {
            ...options.user,
            id: fromBase64Url(options.user.id)
        };

        if (Array.isArray(options.excludeCredentials)) {
            normalized.excludeCredentials = options.excludeCredentials.map((cred) => ({
                ...cred,
                id: fromBase64Url(cred.id)
            }));
        }

        return normalized;
    }

    function normalizeRequestOptions(options) {
        const normalized = { ...options };
        normalized.challenge = fromBase64Url(options.challenge);

        if (Array.isArray(options.allowCredentials)) {
            normalized.allowCredentials = options.allowCredentials.map((cred) => ({
                ...cred,
                id: fromBase64Url(cred.id)
            }));
        }

        return normalized;
    }

    function getErrorMessage(error, fallback) {
        if (error && typeof error.message === 'string') {
            return error.message;
        }
        return fallback;
    }

    function ensurePasskeySupport() {
        if (!global.isSecureContext) {
            throw new Error('Passkeys require a secure context (HTTPS or localhost).');
        }

        if (!global.PublicKeyCredential || !navigator.credentials) {
            throw new Error('This browser does not support passkeys.');
        }
    }

    async function postJSON(url, body) {
        const csrfToken = getCookie('_csrf_token');
        const headers = {
            'Content-Type': 'application/json'
        };

        if (csrfToken) {
            headers['x-csrf-token'] = csrfToken;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(body || {})
        });

        let data;
        try {
            data = await response.json();
        } catch (err) {
            throw new Error('Unexpected response from server.');
        }

        if (!response.ok || data.success === false) {
            throw new Error(data.error || 'Request failed.');
        }

        return data;
    }

    async function beginRegistration(params) {
        ensurePasskeySupport();

        const optionsUrl = params.optionsUrl || '/platform/auth/passkeys/register/options';
        const verifyUrl = params.verifyUrl || '/platform/auth/passkeys/register/verify';

        const optionsResponse = await postJSON(optionsUrl, params.body || {});
        const publicKey = normalizeCreationOptions(optionsResponse.options);

        let credential;
        try {
            credential = await navigator.credentials.create({ publicKey });
        } catch (error) {
            throw new Error(getErrorMessage(error, 'Passkey registration was cancelled.'));
        }

        if (!credential) {
            throw new Error('Passkey registration was cancelled.');
        }

        const verifyBody = {
            ceremonyId: optionsResponse.ceremonyId,
            response: serializeRegistrationCredential(credential),
            deviceLabel: params.deviceLabel || null
        };

        return await postJSON(verifyUrl, verifyBody);
    }

    async function beginAuthentication(params) {
        ensurePasskeySupport();

        const optionsUrl = params.optionsUrl || '/platform/auth/passkeys/login/options';
        const verifyUrl = params.verifyUrl || '/platform/auth/passkeys/login/verify';

        const optionsResponse = await postJSON(optionsUrl, {
            username: params.username || params.email || params.identifier || ''
        });

        const publicKey = normalizeRequestOptions(optionsResponse.options);

        let credential;
        try {
            credential = await navigator.credentials.get({ publicKey });
        } catch (error) {
            throw new Error(getErrorMessage(error, 'Passkey sign-in was cancelled.'));
        }

        if (!credential) {
            throw new Error('Passkey sign-in was cancelled.');
        }

        const verifyBody = {
            ceremonyId: optionsResponse.ceremonyId,
            response: serializeAuthenticationCredential(credential)
        };

        return await postJSON(verifyUrl, verifyBody);
    }

    global.DarklockPasskeys = {
        isSupported: function() {
            return Boolean(global.isSecureContext && global.PublicKeyCredential && navigator.credentials);
        },
        beginRegistration,
        beginAuthentication
    };
})(window);
