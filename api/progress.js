import { createClient } from '@supabase/supabase-js';
import { applyHeaders, isRateLimited } from './_lib.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  applyHeaders(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  if (isRateLimited(`${user.id}:progress`, 60, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  if (req.method === 'GET') {
    const [{ data: progress }, { data: profile }, { data: mistakes }] = await Promise.all([
      supabase.from('progress').select('*').eq('user_id', user.id).order('last_practiced', { ascending: false }),
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('mistakes').select('*').eq('user_id', user.id).order('count', { ascending: false }).limit(10),
    ]);
    return res.status(200).json({ progress: progress || [], profile, mistakes: mistakes || [] });
  }

  if (req.method === 'POST') {
    const { subject, topic, correct, total, xpEarned } = req.body || {};

    if (typeof total !== 'number' || total < 0) return res.status(400).json({ error: 'total must be a non-negative number' });
    if (typeof correct !== 'number' || correct < 0) return res.status(400).json({ error: 'correct must be a non-negative number' });
    if (correct > total) return res.status(400).json({ error: 'correct cannot exceed total' });
    if (xpEarned !== undefined && (typeof xpEarned !== 'number' || xpEarned < 0)) {
      return res.status(400).json({ error: 'xpEarned must be a non-negative number' });
    }

    const accuracy = total > 0 ? Math.min(100, Math.round((correct / total) * 100)) : 0;

    await supabase.from('progress').upsert(
      {
        user_id: user.id,
        subject,
        topic,
        accuracy,
        questions_done: total,
        last_practiced: new Date().toISOString(),
      },
      { onConflict: 'user_id,subject,topic' },
    );

    await supabase.rpc('increment_user_stats', {
      uid: user.id,
      xp_add: xpEarned || 0,
      questions_add: total || 0,
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
