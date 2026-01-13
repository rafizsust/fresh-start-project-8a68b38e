-- Reset flash quota exhaustion for all active Gemini keys
-- This allows the system to retry these keys
UPDATE api_keys 
SET 
  flash_quota_exhausted = false,
  flash_quota_exhausted_date = NULL,
  updated_at = now()
WHERE provider = 'gemini' 
  AND is_active = true 
  AND flash_quota_exhausted = true;