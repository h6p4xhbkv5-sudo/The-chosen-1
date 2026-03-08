import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
    const { data } = await supabase.from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    return res.status(200).json({ users: data || [] });
  }

  if (action === 'send_weekly_emails') {
    const { data: users } = await supabase.from('profiles')
      .select('email,name,xp,accuracy,streak,questions_answered')
      .eq('subscription_status', 'active');
    let sent = 0;
    for (const user of (users || [])) {
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
      }).catch(() => {});
      sent++;
    }
    return res.status(200).json({ sent });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
