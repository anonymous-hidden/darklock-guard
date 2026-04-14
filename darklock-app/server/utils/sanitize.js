// Input sanitization for server-side data
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;
const MAX_STRING_LENGTH = 1000;

function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  return input.slice(0, MAX_STRING_LENGTH).trim();
}

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_REGEX.test(username);
}

function isValidBase64(str) {
  if (typeof str !== 'string' || str.length === 0 || str.length > 4096) return false;
  try {
    return Buffer.from(str, 'base64').toString('base64') === str;
  } catch {
    return false;
  }
}

function isValidUUID(str) {
  return typeof str === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

function sanitizeServerName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[<>&"']/g, '').slice(0, 100).trim();
}

module.exports = { sanitizeString, isValidUsername, isValidBase64, isValidUUID, sanitizeServerName };
