import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, email, password, name, learning_difficulty, year_group, subjects } = req.body;

  try {
    if (action === 'signup') {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name }
      });
      if (error) return res.status(400).json({ error: error.message });

      await supabase.from('profiles').insert({
        id: data.user.id,
        name,
        email,
        plan: 'free',
        subscription_status: 'free',
        learning_difficulty: learning_difficulty || 'none',
        year_group: year_group || '',
        subjects: subjects || [],
        xp: 0,
        level: 1,
        streak: 0,
        longest_streak: 0,
        questions_answered: 0,
        accuracy: 0,
        last_active: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString()
      });

      // Send welcome email
      try {
        await fetch(`${process.env.SITE_URL}/api/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'welcome', email, name })
        });
      } catch (e) { /* email is non-critical */ }

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

      // Update last_active and streak
      const today = new Date().toISOString().split('T')[0];
      if (profile && profile.last_active !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const newStreak = profile.last_active === yesterday ? profile.streak + 1 : 1;
        const longestStreak = Math.max(newStreak, profile.longest_streak || 0);
        await supabase.from('profiles').update({
          last_active: today,
          streak: newStreak,
          longest_streak: longestStreak
        }).eq('id', data.user.id);
        if (profile) {
          profile.streak = newStreak;
          profile.longest_streak = longestStreak;
          profile.last_active = today;
        }
      }

      return res.status(200).json({
        success: true,
        token: data.session.access_token,
        user: { ...data.user, ...profile }
      });
    }

    if (action === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.SITE_URL}/reset-password`
      });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'verify') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });
      const { data, error } = await supabase.auth.getUser(token);
      if (error) return res.status(401).json({ error: 'Invalid token' });
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
      return res.status(200).json({ success: true, user: { ...data.user, ...profile } });
    }

    if (action === 'update_profile') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });
      const { data: authData, error: authErr } = await supabase.auth.getUser(token);
      if (authErr) return res.status(401).json({ error: 'Invalid token' });

      const updates = {};
      if (name) updates.name = name;
      if (learning_difficulty) updates.learning_difficulty = learning_difficulty;
      if (year_group) updates.year_group = year_group;
      if (subjects) updates.subjects = subjects;

      const { data: profile, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', authData.user.id)
        .select()
        .single();

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true, profile });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
