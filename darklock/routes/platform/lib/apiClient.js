const DEFAULT_TIMEOUT = Number(process.env.PLATFORM_API_TIMEOUT || 8000);

function getBaseUrl(req) {
    if (process.env.PLATFORM_API_BASE) {
        return process.env.PLATFORM_API_BASE.replace(/\/$/, '');
    }
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}`;
}

function buildHeaders(req, extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    if (process.env.PLATFORM_API_BEARER) {
        headers.authorization = `Bearer ${process.env.PLATFORM_API_BEARER}`;
    } else if (req?.headers?.cookie) {
        headers.cookie = req.headers.cookie;
    }
    return headers;
}

async function get(path, req, options = {}) {
    const base = getBaseUrl(req);
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT);

    const fetchFn = global.fetch;
    if (typeof fetchFn !== 'function') {
        throw new Error('Fetch API is unavailable in this runtime. Please use Node 18+ or provide a fetch polyfill.');
    }

    try {
        const response = await fetchFn(url, {
            method: 'GET',
            headers: buildHeaders(req, options.headers),
            signal: controller.signal
        });

        const text = await response.text();
        let body = null;
        if (text) {
            try { body = JSON.parse(text); } catch (_) { body = text; }
        }

        if (!response.ok) {
            const err = new Error(body?.error || response.statusText || 'Request failed');
            err.status = response.status;
            err.body = body;
            throw err;
        }

        return body;
    } finally {
        clearTimeout(timeout);
    }
}

async function post(path, req, body = {}, options = {}) {
    const base = getBaseUrl(req);
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT);

    const fetchFn = global.fetch;
    if (typeof fetchFn !== 'function') {
        throw new Error('Fetch API is unavailable in this runtime. Please use Node 18+ or provide a fetch polyfill.');
    }

    try {
        const response = await fetchFn(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...buildHeaders(req, options.headers)
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        const text = await response.text();
        let responseBody = null;
        if (text) {
            try { responseBody = JSON.parse(text); } catch (_) { responseBody = text; }
        }

        if (!response.ok) {
            const err = new Error(responseBody?.error || response.statusText || 'Request failed');
            err.status = response.status;
            err.body = responseBody;
            throw err;
        }

        return responseBody;
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    get,
    post
};
