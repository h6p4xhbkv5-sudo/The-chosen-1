import { createClient } from '@supabase/supabase-js';
import { applyHeaders, isRateLimited, getIp } from './_lib.js';

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  if (!supabase) return res.status(503).json({ error: 'Database not configured' });
  applyHeaders(res, 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = getIp(req);
  if (isRateLimited(`${ip}:admin`, 5, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const action = req.query?.action || req.body?.action;

  if (action === 'stats') {
    const [users, active, paying] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true })
        .gte('last_active', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      supabase.from('profiles').select('id', { count: 'exact', head: true })
        .in('subscription_status', ['active'])
    ]);
    return res.status(200).json({
      total_users: users.count || 0,
      active_7d: active.count || 0,
      paying: paying.count || 0
    });
  }

  if (action === 'users') {
    const page = parseInt(req.query?.page || req.body?.page, 10) || 1;
    const limit = 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, count } = await supabase.from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    return res.status(200).json({ users: data || [], total: count || 0, page });
  }

  if (action === 'send_weekly_emails') {
    const { data: users } = await supabase.from('profiles')
      .select('email,name,xp,accuracy,streak,questions_answered')
      .eq('subscription_status', 'active');
    let sent = 0;
    let failed = 0;
    for (const user of (users || [])) {
      try {
        await fetch(`${process.env.SITE_URL}/api/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'weekly',
            email: user.email,
            name: user.name,
            stats: {
              questions: user.questions_answered,
              accuracy: user.accuracy,
              xp: user.xp,
              streak: user.streak
            }
          })
        });
        sent++;
      } catch {
        failed++;
      }
    }
    return res.status(200).json({ sent, failed });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
