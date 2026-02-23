/**
 * Darklock Guard — API Client
 *
 * Centralized API configuration and request utilities.
 * Automatically uses localhost in development, production URL in builds.
 */

/**
 * Get the Darklock Platform API base URL.
 * In dev: http://localhost:3002
 * In production: https://darklock.net
 */
export function getPlatformApiUrl(): string {
  // In Tauri, we're always in "dev mode" for API purposes when running via tauri dev
  // Check multiple conditions to detect development
  const isTauriDev =
    window.location.protocol === 'http:' || 
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'tauri.localhost';
  
  if (isTauriDev) {
    return 'http://localhost:3002';
  }
  
  return 'https://darklock.net';
}

/**
 * Make an authenticated API request to the Darklock Platform.
 */
export async function platformFetch(
  endpoint: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  const baseUrl = getPlatformApiUrl();
  const url = `${baseUrl}${endpoint}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  console.log(`[API Client] ${options.method || 'GET'} ${url}`);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });
    
    console.log(`[API Client] Response: ${response.status} ${response.statusText}`);
    return response;
  } catch (err) {
    console.error('[API Client] Request failed:', err);
    throw err;
  }
}
