/**
 * Accent Preference Storage
 * Persists user's accent choice for Chrome
 * Includes auto-detection based on user location/timezone and geolocation
 */

const STORAGE_KEY = 'ielts_preferred_accent';
const AUTO_DETECTED_KEY = 'ielts_accent_auto_detected';
const GEOLOCATION_CHECKED_KEY = 'ielts_geolocation_checked';
// Default to Indian English as it's most common for IELTS test takers
const DEFAULT_ACCENT = 'en-IN';

// Map timezones to recommended accents
const TIMEZONE_TO_ACCENT: Record<string, string> = {
  // South Asian region -> Indian English
  'Asia/Kolkata': 'en-IN',
  'Asia/Dhaka': 'en-IN', // Bangladesh -> Indian English
  'Asia/Karachi': 'en-IN',
  'Asia/Colombo': 'en-IN',
  'Asia/Kathmandu': 'en-IN',
  'Asia/Thimphu': 'en-IN',
  'Asia/Yangon': 'en-IN', // Myanmar -> Indian English
  'Asia/Rangoon': 'en-IN', // Myanmar alternative timezone
  // Southeast Asia -> Indian English (most IELTS test takers from this region)
  'Asia/Singapore': 'en-IN',
  'Asia/Kuala_Lumpur': 'en-IN',
  'Asia/Bangkok': 'en-IN',
  'Asia/Jakarta': 'en-IN',
  'Asia/Manila': 'en-IN',
  'Asia/Ho_Chi_Minh': 'en-IN',
  // East Asia -> Indian English (closer to IELTS test context)
  'Asia/Shanghai': 'en-IN',
  'Asia/Tokyo': 'en-IN',
  'Asia/Seoul': 'en-IN',
  'Asia/Hong_Kong': 'en-IN',
  'Asia/Taipei': 'en-IN',
  // Australia/NZ
  'Australia/Sydney': 'en-AU',
  'Australia/Melbourne': 'en-AU',
  'Australia/Brisbane': 'en-AU',
  'Australia/Perth': 'en-AU',
  'Pacific/Auckland': 'en-NZ',
  // UK/Ireland
  'Europe/London': 'en-GB',
  'Europe/Dublin': 'en-IE',
  // North America
  'America/New_York': 'en-US',
  'America/Los_Angeles': 'en-US',
  'America/Chicago': 'en-US',
  'America/Denver': 'en-US',
  'America/Toronto': 'en-CA',
  'America/Vancouver': 'en-CA',
  // South Africa
  'Africa/Johannesburg': 'en-ZA',
};

// Map country codes (ISO 3166-1 alpha-2) to accents
const COUNTRY_TO_ACCENT: Record<string, string> = {
  // South Asia -> Indian English
  'IN': 'en-IN', // India
  'BD': 'en-IN', // Bangladesh
  'PK': 'en-IN', // Pakistan
  'LK': 'en-IN', // Sri Lanka
  'NP': 'en-IN', // Nepal
  'BT': 'en-IN', // Bhutan
  'MM': 'en-IN', // Myanmar
  'AF': 'en-IN', // Afghanistan
  // Southeast Asia -> Indian English
  'SG': 'en-IN', // Singapore
  'MY': 'en-IN', // Malaysia
  'TH': 'en-IN', // Thailand
  'ID': 'en-IN', // Indonesia
  'PH': 'en-IN', // Philippines
  'VN': 'en-IN', // Vietnam
  'KH': 'en-IN', // Cambodia
  'LA': 'en-IN', // Laos
  // East Asia -> Indian English
  'CN': 'en-IN', // China
  'JP': 'en-IN', // Japan
  'KR': 'en-IN', // South Korea
  'HK': 'en-IN', // Hong Kong
  'TW': 'en-IN', // Taiwan
  'MO': 'en-IN', // Macau
  // Middle East -> Indian English
  'AE': 'en-IN', // UAE
  'SA': 'en-IN', // Saudi Arabia
  'QA': 'en-IN', // Qatar
  'KW': 'en-IN', // Kuwait
  'BH': 'en-IN', // Bahrain
  'OM': 'en-IN', // Oman
  'IR': 'en-IN', // Iran
  'IQ': 'en-IN', // Iraq
  // Australia/NZ
  'AU': 'en-AU', // Australia
  'NZ': 'en-NZ', // New Zealand
  // UK/Ireland
  'GB': 'en-GB', // United Kingdom
  'IE': 'en-IE', // Ireland
  // North America
  'US': 'en-US', // United States
  'CA': 'en-CA', // Canada
  // South Africa
  'ZA': 'en-ZA', // South Africa
};

// Approximate coordinate bounds for regions (lat/lng bounding boxes)
interface RegionBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  accent: string;
}

const REGION_BOUNDS: RegionBounds[] = [
  // South Asia (India, Bangladesh, Pakistan, Sri Lanka, Nepal, Bhutan)
  { minLat: 5, maxLat: 37, minLng: 60, maxLng: 98, accent: 'en-IN' },
  // Southeast Asia
  { minLat: -11, maxLat: 28, minLng: 92, maxLng: 141, accent: 'en-IN' },
  // East Asia (China, Japan, Korea)
  { minLat: 18, maxLat: 54, minLng: 100, maxLng: 150, accent: 'en-IN' },
  // Middle East
  { minLat: 12, maxLat: 42, minLng: 25, maxLng: 63, accent: 'en-IN' },
  // Australia
  { minLat: -45, maxLat: -10, minLng: 110, maxLng: 155, accent: 'en-AU' },
  // New Zealand
  { minLat: -48, maxLat: -34, minLng: 165, maxLng: 180, accent: 'en-NZ' },
  // UK & Ireland
  { minLat: 49, maxLat: 61, minLng: -11, maxLng: 2, accent: 'en-GB' },
  // USA (continental)
  { minLat: 24, maxLat: 50, minLng: -125, maxLng: -66, accent: 'en-US' },
  // Canada
  { minLat: 41, maxLat: 84, minLng: -141, maxLng: -52, accent: 'en-CA' },
  // South Africa
  { minLat: -35, maxLat: -22, minLng: 16, maxLng: 33, accent: 'en-ZA' },
];

/**
 * Detect accent based on coordinates using region bounds
 */
function detectAccentFromCoordinates(lat: number, lng: number): string | null {
  for (const region of REGION_BOUNDS) {
    if (
      lat >= region.minLat &&
      lat <= region.maxLat &&
      lng >= region.minLng &&
      lng <= region.maxLng
    ) {
      return region.accent;
    }
  }
  return null;
}

/**
 * Get country code from coordinates using a free reverse geocoding API
 * Falls back to coordinate-based detection if API fails
 */
async function getCountryFromCoordinates(lat: number, lng: number): Promise<string | null> {
  try {
    // Use BigDataCloud free reverse geocoding API (no API key required)
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!response.ok) {
      throw new Error('Geocoding API failed');
    }
    
    const data = await response.json();
    return data.countryCode || null;
  } catch {
    // Fall back to coordinate-based detection
    return null;
  }
}

/**
 * Attempt to detect accent using browser Geolocation API
 * Returns a promise that resolves to the detected accent or null
 */
export async function detectAccentFromGeolocation(): Promise<string | null> {
  // Check if geolocation is supported
  if (!navigator.geolocation) {
    console.log('[AccentDetection] Geolocation not supported');
    return null;
  }

  // Check if we've already tried geolocation
  try {
    if (localStorage.getItem(GEOLOCATION_CHECKED_KEY) === 'true') {
      console.log('[AccentDetection] Geolocation already checked, skipping');
      return null;
    }
  } catch {
    // Ignore localStorage errors
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.log('[AccentDetection] Geolocation timed out');
      markGeolocationChecked();
      resolve(null);
    }, 10000); // 10 second timeout

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        clearTimeout(timeoutId);
        const { latitude, longitude } = position.coords;
        console.log('[AccentDetection] Got coordinates:', latitude, longitude);

        // Try to get country code first
        const countryCode = await getCountryFromCoordinates(latitude, longitude);
        if (countryCode && COUNTRY_TO_ACCENT[countryCode]) {
          console.log('[AccentDetection] Detected country:', countryCode);
          markGeolocationChecked();
          resolve(COUNTRY_TO_ACCENT[countryCode]);
          return;
        }

        // Fall back to coordinate-based detection
        const accentFromCoords = detectAccentFromCoordinates(latitude, longitude);
        if (accentFromCoords) {
          console.log('[AccentDetection] Detected from coordinates:', accentFromCoords);
          markGeolocationChecked();
          resolve(accentFromCoords);
          return;
        }

        markGeolocationChecked();
        resolve(null);
      },
      (error) => {
        clearTimeout(timeoutId);
        console.log('[AccentDetection] Geolocation error:', error.message);
        markGeolocationChecked();
        resolve(null);
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 86400000, // Cache for 24 hours
      }
    );
  });
}

function markGeolocationChecked(): void {
  try {
    localStorage.setItem(GEOLOCATION_CHECKED_KEY, 'true');
  } catch {
    // Ignore
  }
}

/**
 * Detect accent based on user's timezone
 */
export function detectAccentFromTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone && TIMEZONE_TO_ACCENT[timezone]) {
      return TIMEZONE_TO_ACCENT[timezone];
    }
    
    // Fallback: check timezone prefix for region-based detection
    if (timezone) {
      // ALL Asian timezones default to Indian English (most common for IELTS)
      if (timezone.startsWith('Asia/')) return 'en-IN';
      if (timezone.startsWith('Australia/')) return 'en-AU';
      if (timezone.startsWith('Europe/')) return 'en-GB';
      if (timezone.startsWith('America/')) return 'en-US';
    }
    
    // Default to Indian English if no timezone detected
    return 'en-IN';
  } catch {
    return DEFAULT_ACCENT;
  }
}

/**
 * Check if accent has been auto-detected before
 */
export function hasAutoDetectedAccent(): boolean {
  try {
    return localStorage.getItem(AUTO_DETECTED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark that accent has been auto-detected
 */
export function markAccentAutoDetected(): void {
  try {
    localStorage.setItem(AUTO_DETECTED_KEY, 'true');
  } catch {
    // Ignore
  }
}

/**
 * Get stored accent, falling back to auto-detection
 * NOTE: Always re-detects if no explicit user preference was saved
 */
export function getStoredAccent(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Only use stored value if the user explicitly selected it
    // If it was auto-detected, re-run detection to get the most accurate result
    if (stored && hasAutoDetectedAccent()) {
      // Check if the stored value matches what detection would give
      // If detection was already done, trust the stored value
      return stored;
    }
    
    // Always run timezone detection for fresh results
    const detected = detectAccentFromTimezone();
    setStoredAccent(detected);
    markAccentAutoDetected();
    return detected;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/**
 * Async version that tries geolocation first, then falls back to timezone
 */
export async function getStoredAccentAsync(): Promise<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    
    // If not auto-detected before, try geolocation first
    if (!hasAutoDetectedAccent()) {
      // Try geolocation (this will be skipped if already checked)
      const geoAccent = await detectAccentFromGeolocation();
      if (geoAccent) {
        setStoredAccent(geoAccent);
        markAccentAutoDetected();
        return geoAccent;
      }
      
      // Fall back to timezone
      const timezoneAccent = detectAccentFromTimezone();
      setStoredAccent(timezoneAccent);
      markAccentAutoDetected();
      return timezoneAccent;
    }
    
    return DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function setStoredAccent(accent: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, accent);
  } catch {
    console.warn('Failed to store accent preference');
  }
}

export function clearStoredAccent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(AUTO_DETECTED_KEY);
    localStorage.removeItem(GEOLOCATION_CHECKED_KEY);
  } catch {
    // Ignore
  }
}
