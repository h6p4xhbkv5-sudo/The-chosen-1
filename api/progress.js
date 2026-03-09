import { createClient } from '@supabase/supabase-js';

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabase) {
    // Demo mode: progress stored client-side only
    if (req.method === 'GET') return res.status(200).json({ progress: [], profile: null, mistakes: [], activity: [] });
    return res.status(200).json({ success: true });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr) return res.status(401).json({ error: 'Invalid token' });

  if (req.method === 'GET') {
    const [progressRes, profileRes, mistakesRes, activityRes] = await Promise.all([
      supabase.from('progress').select('*').eq('user_id', user.id),
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('mistakes').select('*').eq('user_id', user.id).order('count', { ascending: false }).limit(10),
      supabase.from('activity_log').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(84)
    ]);
    return res.status(200).json({
      progress: progressRes.data || [],
      profile: profileRes.data,
      mistakes: mistakesRes.data || [],
      activity: activityRes.data || []
    });
  }

  if (req.method === 'POST') {
    const { subject, topic, correct, total, xpEarned } = req.body;
    if (total < 0) return res.status(400).json({ error: 'total must not be negative' });
    if (correct > total) return res.status(400).json({ error: 'correct must not exceed total' });
    if (xpEarned < 0) return res.status(400).json({ error: 'xpEarned must not be negative' });
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Upsert progress
    await supabase.from('progress').upsert({
      user_id: user.id,
      subject,
      topic,
      accuracy,
      questions_done: total,
      last_practiced: new Date().toISOString()
    }, { onConflict: 'user_id,subject,topic' });

    // Update profile totals
    await supabase.rpc('increment_user_stats', {
      uid: user.id,
      xp_add: xpEarned || 0,
      questions_add: total || 0
    });

    // Log activity
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await supabase.from('activity_log')
      .select('*').eq('user_id', user.id).eq('date', today).single();

    if (existing) {
      await supabase.from('activity_log').update({
        questions_done: existing.questions_done + (total || 0),
        xp_earned: existing.xp_earned + (xpEarned || 0)
      }).eq('id', existing.id);
    } else {
      await supabase.from('activity_log').insert({
        user_id: user.id,
        date: today,
        questions_done: total || 0,
        xp_earned: xpEarned || 0
      });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
