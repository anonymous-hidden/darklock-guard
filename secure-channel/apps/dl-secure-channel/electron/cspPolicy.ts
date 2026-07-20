const DEV_CONNECT_SRC = "connect-src 'self' blob: ws://localhost:1421 ws://localhost:4101 wss://localhost:4101 ws://127.0.0.1:4101 wss://127.0.0.1:4101 http://localhost:4100 https://localhost:4100 http://127.0.0.1:4100 http://127.0.0.1:4101 http://192.168.50.150:4100 ws://192.168.50.150:4101 http://100.101.134.31:4100 ws://100.101.134.31:4101 http://100.84.62.66:4100 http://localhost:1421 https://ids.darklock.net wss://rly.darklock.net https://rly.darklock.net https://admin.darklock.net https://api.giphy.com";

const PROD_CONNECT_SRC = "connect-src 'self' blob: http://192.168.50.150:4100 ws://192.168.50.150:4101 https://ids.darklock.net wss://rly.darklock.net https://rly.darklock.net https://admin.darklock.net https://api.giphy.com";

export function buildConnectSrc(isDev: boolean): string {
  return isDev ? DEV_CONNECT_SRC : PROD_CONNECT_SRC;
}

export function buildContentSecurityPolicy(isDev: boolean): string {
  const connectSrc = buildConnectSrc(isDev);
  const scriptSrc = isDev
    ? "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'wasm-unsafe-eval'";

  return `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ${connectSrc}; img-src 'self' data: blob: https://*.tenor.com https://*.giphy.com https://i.scdn.co; font-src 'self' https://fonts.gstatic.com; media-src 'self' blob: https://*.tenor.com https://*.giphy.com; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';`;
}
