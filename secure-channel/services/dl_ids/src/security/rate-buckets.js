export function hitFixedWindowLimit(bucketMap, key, { limit, windowMs }) {
  const now = Date.now();
  const existing = bucketMap.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    bucketMap.set(key, { windowStart: now, count: 1 });
    return false;
  }

  existing.count += 1;
  if (existing.count > limit) {
    return true;
  }
  return false;
}
