import { applyHeaders } from './_lib.js';

export default function handler(req, res) {
  applyHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cache for 5 minutes — these values don't change at runtime
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    siteUrl: process.env.SITE_URL || ''
  });
}
