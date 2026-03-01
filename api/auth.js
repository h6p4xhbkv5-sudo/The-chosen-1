import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PLANS = ['student', 'homeschool'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, email, password, name, plan } = req.body;

  // Input validation per action
  if (action === 'signup') {
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (plan && !VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  }

  if (action === 'login' || action === 'reset') {
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    if (action === 'signup') {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: { name, plan: plan || 'student' },
      });
      if (error) return res.status(400).json({ error: error.message });

      await supabase.from('profiles').insert({
        id: data.user.id,
        name, email, plan: plan || 'student',
        xp: 0, level: 1, streak: 0,
        questions_answered: 0, accuracy: 0,
        created_at: new Date().toISOString(),
      });

      await supabase.auth.admin.inviteUserByEmail(email);
      return res.status(200).json({ success: true, user: data.user });
    }

    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: 'Invalid email or password' });

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      return res.status(200).json({
        success: true,
        token: data.session.access_token,
        user: { ...data.user, ...profile },
      });
    }

    if (action === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.SITE_URL}/reset-password`,
      });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'verify') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });
      const { data, error } = await supabase.auth.getUser(token);
      if (error) return res.status(401).json({ error: 'Invalid token' });
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', data.user.id).single();
      return res.status(200).json({ success: true, user: { ...data.user, ...profile } });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
