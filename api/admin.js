import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { applyHeaders, isRateLimited, getIp } from './_lib.js';

export default async function handler(req, res) {
  applyHeaders(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Rate limit admin endpoint: 30 per IP per minute
  if (isRateLimited(`${getIp(req)}:admin`, 30, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Guard: reject if admin key env var is not configured (prevents bypass when var is undefined)
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_SECRET_KEY || !adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { action } = req.query;

  try {
    if (action === 'stats') {
      const [users, active, paying] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true })
          .gte('last_active', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),
        supabase.from('profiles').select('id', { count: 'exact', head: true })
          .in('subscription_status', ['active']),
      ]);

      // Get real MRR from Stripe if key is set
      let mrr = 0;
      if (process.env.STRIPE_SECRET_KEY) {
        try {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
          mrr = subs.data.reduce((sum, sub) => {
            return sum + sub.items.data.reduce((s, item) => {
              const amount = item.price.unit_amount / 100;
              return s + (item.price.recurring?.interval === 'year' ? amount / 12 : amount);
            }, 0);
          }, 0);
        } catch (_) { /* Stripe unavailable — MRR stays 0 */ }
      }

      await logAudit(supabase, 'stats', {});
      return res.status(200).json({
        total_users: users.count || 0,
        active_7d: active.count || 0,
        paying: paying.count || 0,
        mrr: Math.round(mrr * 100) / 100,
      });
    }

    if (action === 'users') {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
      const offset = (page - 1) * limit;

      const { data, count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      await logAudit(supabase, 'users_list', { page, limit });
      return res.status(200).json({
        users: data || [],
        total: count || 0,
        page,
        pages: Math.ceil((count || 0) / limit),
      });
    }

    if (action === 'send_weekly_emails') {
      const { data: users } = await supabase
        .from('profiles')
        .select('email,name,xp,accuracy,streak,questions_answered')
        .eq('subscription_status', 'active');

      let sent = 0;
      let failed = 0;
      const errors = [];

      for (const user of (users || [])) {
        try {
          const r = await fetch(`${process.env.SITE_URL}/api/email`, {
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
                streak: user.streak,
              },
            }),
          });
          r.ok ? sent++ : (failed++, errors.push({ email: user.email, status: r.status }));
        } catch (e) {
          failed++;
          errors.push({ email: user.email, error: e.message });
        }
      }

      await logAudit(supabase, 'send_weekly_emails', { sent, failed });
      return res.status(200).json({ sent, failed, errors: errors.slice(0, 10) });
    }

    if (action === 'audit_log') {
      const { data } = await supabase
        .from('admin_audit_log')
        .select('*')
        .order('performed_at', { ascending: false })
        .limit(100);
      return res.status(200).json({ log: data || [] });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function logAudit(supabase, action, details) {
  try {
    await supabase.from('admin_audit_log').insert({
      action,
      performed_at: new Date().toISOString(),
      details,
    });
  } catch (_) { /* non-fatal */ }
}
