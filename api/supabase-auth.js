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
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Missing Supabase config' });

  const { action, payload, upload, userId } = req.body;

  const headers = {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`
  };

  try {
    if (action === 'upsert_profile') {
      const r = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    if (action === 'get_profile') {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(payload.email)}&select=*`,
        { headers }
      );
      const data = await r.json();
      return res.status(r.status).json(data[0] || null);
    }

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
