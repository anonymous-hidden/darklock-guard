export const config = {
  apiUrl: import.meta.env.VITE_DARKLOCK_API_URL || 'http://localhost:4200',
  wsUrl: import.meta.env.VITE_DARKLOCK_WS_URL || 'ws://localhost:4200/ws',
  certFingerprint: import.meta.env.VITE_DARKLOCK_CERT_PIN || null
};
