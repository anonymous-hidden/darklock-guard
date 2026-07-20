// Wait for Vite dev server to be ready before launching Electron
const http = require('http');
const url = 'http://127.0.0.1:1421';
const timeout = 30000;
const start = Date.now();

function check() {
  if (Date.now() - start > timeout) {
    console.error('[wait] Vite did not start within 30s');
    process.exit(1);
  }
  http.get(url, (res) => {
    if (res.statusCode === 200) {
      console.log('[wait] Vite ready');
      process.exit(0);
    } else {
      retry();
    }
  }).on('error', retry);
}

function retry() {
  setTimeout(check, 400);
}

check();
