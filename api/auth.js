import { createClient } from '@supabase/supabase-js';
import { applyHeaders, isRateLimited, getIp } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PLANS = ['student', 'homeschool'];

// Safe Supabase init — won't crash if env vars are missing
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
} catch (e) {
  supabase = null;
}

export default async function handler(req, res) {
  applyHeaders(res, 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = getIp(req);
  if (isRateLimited(`${ip}:auth`, 20, 60_000)) {
    return res.status(429).json({ error: 'Too many requests — please try again later' });
  }

  const { action, email, password, name, plan, learning_difficulty, year_group, subjects } = req.body || {};

  if (!supabase) {
    return handleDemoMode(res, { action, email, password, name, plan, year_group, subjects, learning_difficulty });
  }

  try {
    if (action === 'signup') {
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
      if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      if (!name) return res.status(400).json({ error: 'Name is required' });
      if (plan && !VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan. Must be "student" or "homeschool".' });

      const chosenPlan = plan || 'student';
      const { data, error } = await supabase.auth.admin.createUser({
        email, password, email_confirm: false,
        user_metadata: { name, plan: chosenPlan }
      });
      if (error) return res.status(400).json({ error: error.message });

      await supabase.from('profiles').insert({
        id: data.user.id, name, email,
        plan: chosenPlan, subscription_status: 'free',
        learning_difficulty: learning_difficulty || 'none',
        year_group: year_group || '', subjects: subjects || [],
        xp: 0, level: 1, streak: 0, longest_streak: 0,
        questions_answered: 0, accuracy: 0,
        last_active: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString()
      });

      // Sign in the new user to generate a session token
      const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      const token = session?.session?.access_token || null;

      // Send confirmation email (non-blocking — don't let failure break signup)
      try { await supabase.auth.admin.inviteUserByEmail(email); } catch (_) {}

      return res.status(200).json({ success: true, token, user: data.user });
    }

    if (action === 'login') {
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: 'Invalid email or password' });

      const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();

      const today = new Date().toISOString().split('T')[0];
      if (profile && profile.last_active !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const newStreak = profile.last_active === yesterday ? profile.streak + 1 : 1;
        const longestStreak = Math.max(newStreak, profile.longest_streak || 0);
        await supabase.from('profiles').update({ last_active: today, streak: newStreak, longest_streak: longestStreak }).eq('id', data.user.id);
        if (profile) { profile.streak = newStreak; profile.longest_streak = longestStreak; profile.last_active = today; }
      }

      return res.status(200).json({ success: true, token: data.session.access_token, user: { ...data.user, ...profile } });
    }

    if (action === 'reset') {
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${process.env.SITE_URL}/reset-password` });
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
      const { data: profile, error } = await supabase.from('profiles').update(updates).eq('id', authData.user.id).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true, profile });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    const msg = /fetch|network|ECONNREFUSED|ETIMEDOUT|socket/i.test(e.message)
      ? 'Unable to reach the database. Please try again shortly.'
      : e.message;
    return res.status(500).json({ error: msg });
  }
}

function handleDemoMode(res, { action, email, password, name, plan, year_group, subjects, learning_difficulty }) {
  if (action === 'signup') {
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const demoId = 'demo_' + Date.now().toString(36);
    return res.status(200).json({
      success: true, token: 'demo_token_' + demoId,
      user: { id: demoId, email, name, plan: plan || 'student', subscription_status: 'free',
        year_group: year_group || 'Year 13 (A-Level)', subjects: subjects || ['Mathematics'],
        learning_difficulty: learning_difficulty || 'none', exam_board: 'AQA',
        xp: 0, level: 1, streak: 1, questions_answered: 0, accuracy: 0 }
    });
  }
  if (action === 'login') {
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (!password) return res.status(400).json({ error: 'Please enter your password' });
    const demoId = 'demo_' + Buffer.from(email).toString('base64').slice(0, 12);
    return res.status(200).json({
      success: true, token: 'demo_token_' + demoId,
      user: { id: demoId, email, name: email.split('@')[0], plan: 'student', subscription_status: 'free',
        year_group: 'Year 13 (A-Level)', subjects: ['Mathematics'], exam_board: 'AQA',
        xp: 0, level: 1, streak: 1, questions_answered: 0, accuracy: 0 }
    });
  }
  if (action === 'verify') return res.status(200).json({ success: true, user: { id: 'demo', email: 'demo@synaptiq.app', name: 'Student' } });
  if (action === 'reset') return res.status(200).json({ success: true });
  if (action === 'update_profile') return res.status(200).json({ success: true, profile: {} });
  return res.status(400).json({ error: 'Unknown action' });
}
