/**
 * Darklock Guard — API Client
 *
 * Centralized API configuration and request utilities.
 * Always connects to the hosted Darklock platform — no self-hosting.
 */

// Production backend URLs (Cloudflare Tunnel → Pi5)
const PLATFORM_URL = 'https://platform.darklock.net';

/**
 * Get the Darklock Platform API base URL.
 * Always points to the hosted backend.
 */
export function getPlatformApiUrl(): string {
  return PLATFORM_URL;
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
