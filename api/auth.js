import { createClient } from '@supabase/supabase-js';
import { applyHeaders, isRateLimited, getIp } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PLANS = ['student', 'homeschool'];

export default async function handler(req, res) {
  applyHeaders(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server configuration error — auth service not configured' });
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const ip = getIp(req);
  const { action, email, password, name, plan } = req.body || {};

  // Per-action rate limits
  if (action === 'login' && isRateLimited(`${ip}:login`, 10, 15 * 60_000)) {
    return res.status(429).json({ error: 'Too many login attempts — try again in 15 minutes' });
  }
  if (action === 'signup' && isRateLimited(`${ip}:signup`, 5, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many signup attempts — try again later' });
  }
  if (action === 'reset' && isRateLimited(`${ip}:reset`, 5, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many reset attempts — try again later' });
  }

  // Input validation
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
        user_metadata: { name: name.trim(), plan: plan || 'student' },
      });
      if (error) return res.status(400).json({ error: error.message });

      await supabase.from('profiles').insert({
        id: data.user.id,
        name: name.trim(),
        email,
        plan: plan || 'student',
        subscription_status: 'free',
        xp: 0,
        level: 1,
        streak: 0,
        questions_answered: 0,
        accuracy: 0,
        created_at: new Date().toISOString(),
      });

      await supabase.auth.admin.inviteUserByEmail(email);
      return res.status(200).json({ success: true, user: data.user });
    }

    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: 'Invalid email or password' });

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', data.user.id).single();

      // Update last_active
      await supabase.from('profiles')
        .update({ last_active: new Date().toISOString().split('T')[0] })
        .eq('id', data.user.id);

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
      if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', data.user.id).single();
      return res.status(200).json({ success: true, user: { ...data.user, ...profile } });
    }

    if (action === 'delete') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });
      const { data, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !data?.user) return res.status(401).json({ error: 'Unauthorized' });

      // Cancel any active Stripe subscription via profile lookup
      const { data: profile } = await supabase
        .from('profiles').select('stripe_customer_id, subscription_id').eq('id', data.user.id).single();
      if (profile?.subscription_id) {
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          await stripe.subscriptions.cancel(profile.subscription_id);
        } catch (_) { /* non-fatal — still delete the account */ }
      }

      // deleteUser cascades to all tables via FK
      const { error: delErr } = await supabase.auth.admin.deleteUser(data.user.id);
      if (delErr) return res.status(500).json({ error: delErr.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
