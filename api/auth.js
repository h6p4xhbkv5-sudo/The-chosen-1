import { createClient } from '@supabase/supabase-js';
import { applyHeaders, isRateLimited, getIp } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PLANS = ['student'];

// Safe Supabase init — won't crash if env vars are missing
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
} catch (e) {
  supabase = null;
}

export default async function handler(req, res) {
  applyHeaders(res, 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIp(req);
  if (isRateLimited(`${ip}:auth`, 20, 60_000)) {
    return res.status(429).json({ error: 'Too many requests — please try again later' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (_) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { action, email, password, name, plan, learning_difficulty, year_group, subjects } = body;

  if (!action) return res.status(400).json({ error: 'Missing action parameter' });

  if (!supabase) {
    return handleDemoMode(res, { action, email, password, name, plan, year_group, subjects, learning_difficulty });
  }

  try {
    if (action === 'signup') {
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
      if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
      if (plan && !VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });

      const chosenPlan = plan || 'student';
      const trimmedName = name.trim();

      // Create user in Supabase Auth
      const { data, error } = await supabase.auth.admin.createUser({
        email: email.toLowerCase().trim(),
        password,
        email_confirm: false,
        user_metadata: { name: trimmedName, plan: chosenPlan }
      });
      if (error) {
        // Friendly duplicate email message
        if (error.message.includes('already') || error.message.includes('duplicate'))
          return res.status(400).json({ error: 'An account with this email already exists. Try logging in instead.' });
        return res.status(400).json({ error: error.message });
      }

      // Create profile row
      const profileData = {
        id: data.user.id, name: trimmedName, email: email.toLowerCase().trim(),
        plan: chosenPlan, subscription_status: 'free',
        learning_difficulty: learning_difficulty || 'none',
        year_group: year_group || '', subjects: subjects || ['Mathematics'],
        xp: 0, level: 1, streak: 1, longest_streak: 1,
        questions_answered: 0, accuracy: 0,
        last_active: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString()
      };
      await supabase.from('profiles').upsert(profileData, { onConflict: 'id' });

      // Sign in the new user to generate a session token
      let token = null;
      try {
        const { data: session } = await supabase.auth.signInWithPassword({ email: email.toLowerCase().trim(), password });
        token = session?.session?.access_token || null;
      } catch (_) { /* token stays null — user can log in separately */ }

      // Send confirmation email (non-blocking)
      try { await supabase.auth.admin.inviteUserByEmail(email); } catch (_) {}

      return res.status(200).json({
        success: true, token,
        user: { ...data.user, ...profileData, id: data.user.id }
      });
    }

    if (action === 'login') {
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
      if (!password) return res.status(400).json({ error: 'Please enter your password' });

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(), password
      });
      if (error) return res.status(401).json({ error: 'Invalid email or password' });

      // Fetch profile, create one if missing
      let { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
      if (!profile) {
        profile = {
          id: data.user.id,
          name: data.user.user_metadata?.name || email.split('@')[0],
          email: email.toLowerCase().trim(),
          plan: 'student', subscription_status: 'free',
          xp: 0, level: 1, streak: 1, longest_streak: 1,
          questions_answered: 0, accuracy: 0,
          last_active: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString()
        };
        await supabase.from('profiles').upsert(profile, { onConflict: 'id' });
      }

      // Update streak
      const today = new Date().toISOString().split('T')[0];
      if (profile.last_active !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const newStreak = profile.last_active === yesterday ? (profile.streak || 0) + 1 : 1;
        const longestStreak = Math.max(newStreak, profile.longest_streak || 0);
        await supabase.from('profiles').update({ last_active: today, streak: newStreak, longest_streak: longestStreak }).eq('id', data.user.id);
        profile.streak = newStreak;
        profile.longest_streak = longestStreak;
        profile.last_active = today;
      }

      return res.status(200).json({
        success: true,
        token: data.session.access_token,
        user: { ...data.user, ...profile }
      });
    }

    if (action === 'reset') {
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
      const siteUrl = process.env.SITE_URL || 'https://synaptiq.vercel.app';
      const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), { redirectTo: `${siteUrl}/reset-password` });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'verify') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });
      if (token.startsWith('demo_token_')) {
        return res.status(200).json({ success: true, user: { id: 'demo', email: 'demo@synaptiq.app', name: 'Student', plan: 'student' } });
      }
      const { data, error } = await supabase.auth.getUser(token);
      if (error) return res.status(401).json({ error: 'Session expired. Please log in again.' });
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
      return res.status(200).json({ success: true, user: { ...data.user, ...profile } });
    }

    if (action === 'update_profile') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });
      const { data: authData, error: authErr } = await supabase.auth.getUser(token);
      if (authErr) return res.status(401).json({ error: 'Invalid token' });
      const updates = {};
      if (name) updates.name = name.trim();
      if (learning_difficulty) updates.learning_difficulty = learning_difficulty;
      if (year_group) updates.year_group = year_group;
      if (subjects) updates.subjects = subjects;
      const { data: profile, error } = await supabase.from('profiles').update(updates).eq('id', authData.user.id).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true, profile });
    }

    if (action === 'delete_account') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });
      const { data: authData, error: authErr } = await supabase.auth.getUser(token);
      if (authErr) return res.status(401).json({ error: 'Invalid token' });
      // Delete profile data first, then auth user
      await supabase.from('activity_log').delete().eq('user_id', authData.user.id);
      await supabase.from('notes').delete().eq('user_id', authData.user.id);
      await supabase.from('progress').delete().eq('user_id', authData.user.id);
      await supabase.from('chat_history').delete().eq('user_id', authData.user.id);
      await supabase.from('flashcards').delete().eq('user_id', authData.user.id);
      await supabase.from('mistakes').delete().eq('user_id', authData.user.id);
      await supabase.from('profiles').delete().eq('id', authData.user.id);
      await supabase.auth.admin.deleteUser(authData.user.id);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action. Valid: signup, login, reset, verify, update_profile, delete_account' });
  } catch (e) {
    const msg = /fetch|network|ECONNREFUSED|ETIMEDOUT|socket|abort/i.test(e.message)
      ? 'Unable to reach the database. Please check your connection and try again.'
      : e.message;
    return res.status(500).json({ error: msg });
  }
}

function handleDemoMode(res, { action, email, password, name, plan, year_group, subjects, learning_difficulty }) {
  const makeUser = (id, e, n, extra = {}) => ({
    id, email: e, name: n,
    plan: plan || 'student', subscription_status: 'free',
    year_group: year_group || 'Year 13 (A-Level)',
    subjects: subjects || ['Mathematics'],
    learning_difficulty: learning_difficulty || 'none',
    exam_board: 'AQA',
    xp: 0, level: 1, streak: 1, longest_streak: 1,
    questions_answered: 0, accuracy: 0,
    created_at: new Date().toISOString(),
    last_active: new Date().toISOString().split('T')[0],
    ...extra
  });

  if (action === 'signup') {
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const demoId = 'demo_' + Date.now().toString(36);
    return res.status(200).json({
      success: true, token: 'demo_token_' + demoId,
      user: makeUser(demoId, email, name.trim())
    });
  }
  if (action === 'login') {
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (!password) return res.status(400).json({ error: 'Please enter your password' });
    const demoId = 'demo_' + Buffer.from(email).toString('base64').slice(0, 12);
    return res.status(200).json({
      success: true, token: 'demo_token_' + demoId,
      user: makeUser(demoId, email, email.split('@')[0])
    });
  }
  if (action === 'verify') {
    return res.status(200).json({
      success: true,
      user: makeUser('demo', 'demo@synaptiq.app', 'Student')
    });
  }
  if (action === 'reset') return res.status(200).json({ success: true, message: 'If an account exists with this email, a reset link has been sent.' });
  if (action === 'update_profile') return res.status(200).json({ success: true, profile: { name, learning_difficulty, year_group, subjects } });
  if (action === 'delete_account') return res.status(200).json({ success: true });
  return res.status(400).json({ error: 'Unknown action' });
}
