function normalizeEventCode(value) {
  const normalized = String(value ?? 'IDS_SECURITY_EVENT')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || 'IDS_SECURITY_EVENT';
}

export function formatSecurityEvent(code, metadata = {}) {
  const safe = { event: normalizeEventCode(code) };
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/i.test(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      safe[key] = value;
    }
  }
  return JSON.stringify(safe);
}

export function securityEvent(code, metadata = {}, level = 'info') {
  const output = formatSecurityEvent(code, metadata);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}
