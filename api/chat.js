import { createClient } from '@supabase/supabase-js';
import { applyHeaders, isRateLimited } from './_lib.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Max request body size: 32 KB (protects against oversized prompts)
const MAX_BODY_BYTES = 32 * 1024;

export default async function handler(req, res) {
  applyHeaders(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate — must have a valid Supabase session
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Rate limit: 30 AI requests per user per minute
  if (isRateLimited(`${user.id}:chat`, 30, 60_000)) {
    return res.status(429).json({ error: 'Too many requests — slow down a little' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  // Body size check
  const bodyStr = JSON.stringify(req.body);
  if (Buffer.byteLength(bodyStr) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large' });
  }

  // Validate basic shape: must have a messages array
  if (!req.body?.messages || !Array.isArray(req.body.messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: bodyStr,
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'AI service unavailable' });
  }
}
