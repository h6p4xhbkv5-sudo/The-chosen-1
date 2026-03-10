/**
 * GET /api/export
 * GDPR data export — returns all data for the authenticated user as JSON.
 * Rate-limited to 5 requests per hour per user.
 */

import { createClient } from '@supabase/supabase-js';
import { applyHeaders, isRateLimited } from './_lib.js';

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const TABLES = [
  'profiles',
  'progress',
  'notes',
  'chat_history',
  'flashcards',
  'mistakes',
  'exams',
  'activity_log',
];

export default async function handler(req, res) {
  applyHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!supabase) return res.status(200).json({ exported_at: new Date().toISOString(), data: {}, note: 'Demo mode — no server data stored' });

  // Authenticate
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Rate limit: 5 exports per user per hour
  if (isRateLimited(`${user.id}:export`, 5, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many export requests — please wait before trying again' });
  }

  try {
    const result = {
      exported_at: new Date().toISOString(),
      user_id: user.id,
      email: user.email,
      data: {},
    };

    // Fetch all tables in parallel
    const fetches = TABLES.map(async (table) => {
      const col = table === 'profiles' ? 'id' : 'user_id';
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq(col, user.id);

      if (!error) result.data[table] = data || [];
    });

    await Promise.all(fetches);

    res.setHeader('Content-Disposition', `attachment; filename="lumina-data-export-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(result);
  } catch (e) {
    const msg = /fetch|network|ECONNREFUSED|ETIMEDOUT|socket/i.test(e.message)
      ? 'Unable to reach the database. Please try again shortly.'
      : e.message;
    return res.status(500).json({ error: msg });
  }
}
