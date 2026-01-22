// Utility functions

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Format timestamp to relative time
 */
export function timeAgo(timestamp) {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now - then) / 1000);
  
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
  ];
  
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
    }
  }
  
  return 'just now';
}

/**
 * Format date to locale string
 */
export function formatDate(timestamp, options = {}) {
  const defaults = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  
  return new Date(timestamp).toLocaleString(undefined, { ...defaults, ...options });
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Truncate path from the middle
 */
export function truncatePath(path, maxLength = 50) {
  if (path.length <= maxLength) return path;
  
  const parts = path.split(/[\\/]/);
  if (parts.length <= 3) return truncate(path, maxLength);
  
  const first = parts.slice(0, 2).join('\\');
  const last = parts.slice(-2).join('\\');
  
  return `${first}\\...\\${last}`;
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Generate unique ID
 */
export function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Class name helper (like clsx/classnames)
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

/**
 * Get status color classes based on status
 */
export function getStatusClasses(status) {
  const statusMap = {
    verified: 'badge-success',
    compromised: 'badge-error',
    modified: 'badge-warning',
    unknown: 'badge-info',
    scanning: 'badge-info',
  };
  return statusMap[status] || 'badge-info';
}

/**
 * Get status dot color
 */
export function getStatusDotColor(status) {
  const statusMap = {
    verified: 'status-dot-success',
    compromised: 'status-dot-error',
    modified: 'status-dot-warning',
  };
  return statusMap[status] || '';
}
