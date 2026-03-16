import { applyHeaders, isRateLimited, getIp } from './_lib.js';

export default async function handler(req, res) {
  applyHeaders(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Serve public config on GET (merged from config.js)
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      siteUrl: process.env.SITE_URL || ''
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIp(req);
  if (isRateLimited(`${ip}:supabase-auth`, 60, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Missing Supabase config' });

  const { action, payload, upload, userId } = req.body;

  const headers = {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`
  };

  try {
    // ─── AUTH: Create a Supabase Auth user with email + password ───────────
    if (action === 'create_auth_user') {
      const { email, password } = payload || {};
      if (!email || !password) return res.status(400).json({ error: 'email and password required' });
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, password, email_confirm: true })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || data.msg || 'Could not create auth user' });
      return res.status(200).json({ id: data.id, email: data.email });
    }

    // ─── AUTH: Verify email + password, return profile ──────────────────────
    if (action === 'verify_login') {
      const { email, password } = payload || {};
      if (!email || !password) return res.status(400).json({ error: 'email and password required' });
      if (!anonKey) return res.status(500).json({ error: 'Missing SUPABASE_ANON_KEY' });

      // Step 1: verify credentials via Supabase Auth token endpoint
      const authR = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
        body: JSON.stringify({ email, password })
      });
      const authData = await authR.json();
      if (!authR.ok || authData.error) {
        return res.status(401).json({ error: authData.error_description || authData.error || 'Invalid email or password' });
      }

      // Step 2: fetch extended profile from profiles table
      const profileR = await fetch(
        `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=*`,
        { headers }
      );
      const profiles = await profileR.json();
      const profile = Array.isArray(profiles) ? profiles[0] : null;
      if (!profile) return res.status(404).json({ error: 'Profile not found — please register first' });

      return res.status(200).json(profile);
    }

    // ─── AUTH: Send password reset email ────────────────────────────────────
    if (action === 'forgot_password') {
      const { email } = payload || {};
      if (!email) return res.status(400).json({ error: 'email required' });
      if (!anonKey) return res.status(500).json({ error: 'Missing SUPABASE_ANON_KEY' });
      await fetch(`${supabaseUrl}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
        body: JSON.stringify({ email })
      });
      // Supabase always returns 200 for this endpoint (prevents email enumeration)
      return res.status(200).json({ ok: true });
    }

    // ─── PROFILE: Create / update ───────────────────────────────────────────
    if (action === 'upsert_profile') {
      const r = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    if (action === 'patch_profile') {
      const { id, ...fields } = payload;
      if (!id) return res.status(400).json({ error: 'id required' });
      const r = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
      });
      const data = await r.json();
      return res.status(r.status).json(Array.isArray(data) ? (data[0] || {}) : data);
    }

    if (action === 'get_profile') {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(payload.email)}&select=*`,
        { headers }
      );
      const data = await r.json();
      return res.status(r.status).json(data[0] || null);
    }

    // ─── RESOURCES ──────────────────────────────────────────────────────────
    if (action === 'save_upload') {
      const body = upload || payload;
      if (!body) return res.status(400).json({ error: 'upload required' });
      const r = await fetch(`${supabaseUrl}/rest/v1/resources`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    if (action === 'get_uploads') {
      const uid = userId || payload?.userId;
      if (!uid) return res.status(400).json({ error: 'userId required' });
      // Fetch user-specific uploads AND global shared resources
      const r = await fetch(
        `${supabaseUrl}/rest/v1/resources?or=(user_id.eq.${uid},is_global.eq.true)&select=*&order=uploaded_at.desc`,
        { headers }
      );
      const data = await r.json();
      return res.status(r.status).json({ data: Array.isArray(data) ? data : [] });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
