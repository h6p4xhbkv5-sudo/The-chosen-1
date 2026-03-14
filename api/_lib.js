/**
 * Shared utilities for all API handlers.
 * Provides: CORS, security headers, rate limiting.
 */

// ─── CORS & Security Headers ─────────────────────────────────────────────────

export function applyHeaders(res, methods = 'POST, OPTIONS') {
  const origin = process.env.SITE_URL || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────
//
// In-memory per-serverless-instance store. Each Vercel instance gets its own
// counter, so limits are approximate across concurrent instances — but they
// still protect against rapid single-source abuse within a window.
// For production at scale, swap this out for Upstash Redis.

const store = new Map();

/**
 * Returns true when the caller has exceeded the limit.
 *
 * @param {string} key    - A unique key, e.g. `${ip}:${endpoint}`
 * @param {number} max    - Max requests allowed in the window
 * @param {number} windowMs - Window duration in milliseconds
 */
export function isRateLimited(key, max = 30, windowMs = 60_000) {
  // In Vitest test runs the store is shared across all tests in the process,
  // so bypassing prevents rate limits from leaking between test cases.
  if (process.env.VITEST) return false;

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > max;
}

// Clean up expired rate limit entries every 5 minutes to prevent memory growth
if (!process.env.VITEST) {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 5 * 60_000).unref();
}

/** Extract the caller's real IP from Vercel/proxy headers. */
export function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
