/**
 * Accent Preference Storage
 * Persists user's accent choice for Chrome
 * Includes auto-detection based on user location/timezone
 */

const STORAGE_KEY = 'ielts_preferred_accent';
const AUTO_DETECTED_KEY = 'ielts_accent_auto_detected';
const DEFAULT_ACCENT = 'en-GB';

// Map timezones/countries to recommended accents
const TIMEZONE_TO_ACCENT: Record<string, string> = {
  // South Asian region -> Indian English
  'Asia/Kolkata': 'en-IN',
  'Asia/Dhaka': 'en-IN',
  'Asia/Karachi': 'en-IN',
  'Asia/Colombo': 'en-IN',
  'Asia/Kathmandu': 'en-IN',
  'Asia/Thimphu': 'en-IN',
  // Southeast Asia -> Singaporean English
  'Asia/Singapore': 'en-SG',
  'Asia/Kuala_Lumpur': 'en-SG',
  'Asia/Bangkok': 'en-SG',
  'Asia/Jakarta': 'en-SG',
  'Asia/Manila': 'en-SG',
  'Asia/Ho_Chi_Minh': 'en-SG',
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

/**
 * Detect accent based on user's timezone
 */
export function detectAccentFromTimezone(): string | null {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone && TIMEZONE_TO_ACCENT[timezone]) {
      return TIMEZONE_TO_ACCENT[timezone];
    }
    
    // Fallback: check timezone prefix for region-based detection
    if (timezone) {
      if (timezone.startsWith('Asia/')) {
        // Default South/Southeast Asia to Indian English
        const southAsian = ['Dhaka', 'Kolkata', 'Karachi', 'Colombo', 'Kathmandu', 'Thimphu'];
        if (southAsian.some(city => timezone.includes(city))) {
          return 'en-IN';
        }
      }
      if (timezone.startsWith('Australia/')) return 'en-AU';
      if (timezone.startsWith('Europe/')) return 'en-GB';
      if (timezone.startsWith('America/')) return 'en-US';
    }
    
    return null;
  } catch {
    return null;
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

export function getStoredAccent(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    
    // If no stored accent and not auto-detected before, try to detect
    if (!hasAutoDetectedAccent()) {
      const detected = detectAccentFromTimezone();
      if (detected) {
        setStoredAccent(detected);
        markAccentAutoDetected();
        return detected;
      }
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
  } catch {
    // Ignore
  }
}
