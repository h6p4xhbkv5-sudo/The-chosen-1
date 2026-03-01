import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Admin auth check
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: 'Forbidden' });

  const { action } = req.query;

  if (action === 'stats') {
    const [users, active, paying] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_active', new Date(Date.now() - 7*24*60*60*1000).toISOString()),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).in('subscription_status', ['active'])
    ]);
    return res.status(200).json({
      total_users: users.count || 0,
      active_7d: active.count || 0,
      paying: paying.count || 0
    });
  }

  if (action === 'users') {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(100);
    return res.status(200).json({ users: data || [] });
  }

  if (action === 'send_weekly_emails') {
    const { data: users } = await supabase.from('profiles').select('email,name,xp,accuracy,streak,questions_answered').eq('subscription_status','active');
    let sent = 0;
    for (const user of (users || [])) {
      await fetch(`${process.env.SITE_URL}/api/email`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ type:'weekly', email:user.email, name:user.name, stats:{questions:user.questions_answered,accuracy:user.accuracy,xp:user.xp,streak:user.streak} })
      }).catch(()=>{});
      sent++;
    }
    return res.status(200).json({ sent });
  }

  return res.status(400).json({ error: 'Unknown action' });
  import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, email, password, name, plan } = req.body;

  try {
    if (action === 'signup') {
      const { data, error } = await supabase.auth.admin.createUser({
        email, password,
        email_confirm: false,
        user_metadata: { name, plan: plan || 'student' }
      });
      if (error) return res.status(400).json({ error: error.message });

      // Create profile row
      await supabase.from('profiles').insert({
        id: data.user.id,
        name, email, plan: plan || 'student',
        xp: 0, level: 1, streak: 0,
        questions_answered: 0, accuracy: 0,
        created_at: new Date().toISOString()
      });

      // Send welcome email via Supabase
      await supabase.auth.admin.inviteUserByEmail(email);

      return res.status(200).json({ success: true, user: data.user });
    }

    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: 'Invalid email or password' });

      // Fetch full profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

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

    return res.status(400).json({ error: 'Unknown action' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
  export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
  import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, email, name, stats } = req.body;

  const siteUrl = process.env.SITE_URL || 'https://lumina-ai.vercel.app';

  const templates = {
    welcome: {
      subject: `Welcome to Lumina AI, ${name}! 🎓`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#8B6914);padding:2rem;text-align:center">
          <h1 style="font-size:2rem;margin:0">Lumina AI</h1>
          <p style="opacity:.8;margin:.5rem 0 0">AI-Powered Learning for UK Students</p>
        </div>
        <div style="padding:2rem">
          <h2 style="color:#C9A84C">Welcome, ${name}! 👋</h2>
          <p>You're all set on Lumina AI. Here's what to try first:</p>
          <ul style="line-height:2.2">
            <li>🤖 <strong>Ask your AI Tutor</strong> — type any question</li>
            <li>📝 <strong>Generate practice questions</strong> for your exam subjects</li>
            <li>✍️ <strong>Get essays marked</strong> with a predicted grade</li>
            <li>📷 <strong>Photo a question</strong> from your textbook</li>
            <li>🎬 <strong>Watch a video explanation</strong> on anything you're stuck on</li>
          </ul>
          <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none;margin-top:1rem">Start Learning →</a>
        </div>
        <div style="padding:1rem 2rem;border-top:1px solid rgba(255,255,255,0.1);font-size:.8rem;color:#6B7394;text-align:center">
          Lumina AI · <a href="mailto:support@luminaai.co.uk" style="color:#6B7394">support@luminaai.co.uk</a> · 
          <a href="${siteUrl}/privacy-policy.html" style="color:#6B7394">Privacy</a>
        </div></div>`
    },
    weekly: {
      subject: `Your weekly Lumina progress report 📊`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#8B6914);padding:2rem;text-align:center">
          <h1 style="font-size:1.5rem;margin:0">📊 Weekly Report</h1>
          <p style="opacity:.8">Week ending ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</p>
        </div>
        <div style="padding:2rem">
          <h2 style="color:#C9A84C">Hi ${name}!</h2>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1.5rem 0">
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#C9A84C">${stats?.questions||0}</div><div style="font-size:.8rem;color:#6B7394">Questions answered</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#4ADE80">${stats?.accuracy||0}%</div><div style="font-size:.8rem;color:#6B7394">Accuracy</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#60A5FA">${stats?.xp||0}</div><div style="font-size:.8rem;color:#6B7394">XP earned</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#FB923C">${stats?.streak||0}🔥</div><div style="font-size:.8rem;color:#6B7394">Day streak</div></div>
          </div>
          <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none">Keep Going →</a>
        </div></div>`
    },
    exam_reminder: {
      subject: `⏰ ${stats?.subject} exam in ${stats?.days} days — time to revise!`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;padding:2rem">
        <h2 style="color:#C9A84C">⏰ Exam reminder, ${name}</h2>
        <p>Your <strong>${stats?.subject}</strong> exam is in <strong>${stats?.days} days</strong>.</p>
        <p>Log in to Lumina AI and use the revision timetable, practice questions, and video explainers to make the most of your remaining time.</p>
        <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none;margin-top:1rem">Revise Now →</a>
      </div>`
    }
  };

  const template = templates[type];
  if (!template) return res.status(400).json({ error: 'Unknown email type' });

  // Send via Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Lumina AI <hello@luminaai.co.uk>', to: email, subject: template.subject, html: template.html })
      });
      const result = await r.json();
      return res.status(200).json({ success: true, id: result.id });
    } catch(e) {
      return res.status(500).json({ error: 'Email send failed: ' + e.message });
    }
  }

  // Resend not configured — return preview
  return res.status(200).json({ success: true, note: 'Add RESEND_API_KEY to Vercel to send real emails', preview: template.html });
}
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data } = await supabase.from('notes').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    return res.status(200).json({ notes: data || [] });
  }
  if (req.method === 'POST') {
    const { text, subject, tag } = req.body;
    const { data } = await supabase.from('notes').insert({ user_id: user.id, text, subject, tag, created_at: new Date().toISOString() }).select().single();
    return res.status(200).json({ note: data });
  }
  if (req.method === 'DELETE') {
    const { id } = req.body;
    await supabase.from('notes').delete().eq('id', id).eq('user_id', user.id);
    return res.status(200).json({ success: true });
  }
}
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr) return res.status(401).json({ error: 'Invalid token' });

  if (req.method === 'GET') {
    const { data } = await supabase.from('progress').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const { data: mistakes } = await supabase.from('mistakes').select('*').eq('user_id', user.id).order('count', { ascending: false }).limit(10);
    return res.status(200).json({ progress: data || [], profile, mistakes: mistakes || [] });
  }

  if (req.method === 'POST') {
    const { subject, topic, correct, total, xpEarned } = req.body;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Upsert progress
    await supabase.from('progress').upsert({
      user_id: user.id, subject, topic, accuracy,
      questions_done: total, last_practiced: new Date().toISOString()
    }, { onConflict: 'user_id,subject,topic' });

    // Update profile totals
    await supabase.rpc('increment_user_stats', {
      uid: user.id,
      xp_add: xpEarned || 0,
      questions_add: total || 0
    });

    return res.status(200).json({ success: true });
  }
}
  import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, plan, email, successUrl, cancelUrl } = req.body;

  const prices = {
    student: process.env.STRIPE_PRICE_STUDENT,
    homeschool: process.env.STRIPE_PRICE_HOMESCHOOL
  };

  if (action === 'checkout') {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: prices[plan], quantity: 1 }],
      success_url: (successUrl || process.env.SITE_URL) + '?payment=success',
      cancel_url: (cancelUrl || process.env.SITE_URL) + '?payment=cancelled',
      metadata: { plan }
    });
    return res.status(200).json({ url: session.url });
  }

  if (action === 'portal') {
    // Customer billing portal for managing subscription
    const customers = await stripe.customers.list({ email });
    if (!customers.data.length) return res.status(404).json({ error: 'No subscription found' });
    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: process.env.SITE_URL
    });
    return res.status(200).json({ url: session.url });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const data = event.data.object;

  switch (event.type) {

    case 'checkout.session.completed': {
      const email = data.customer_email;
      const plan = data.metadata?.plan || 'student';
      // Unlock full access in Supabase
      await supabase.from('profiles').update({
        plan,
        subscription_status: 'active',
        stripe_customer_id: data.customer,
        subscription_id: data.subscription
      }).eq('email', email);
      // Send confirmation email
      await sendEmail(email, 'payment_confirmed', { plan });
      console.log(`â Subscription activated: ${email} â ${plan}`);
      break;
    }

    case 'invoice.payment_succeeded': {
      const customerId = data.customer;
      await supabase.from('profiles').update({ subscription_status: 'active' }).eq('stripe_customer_id', customerId);
      break;
    }

    case 'invoice.payment_failed': {
      const customerId = data.customer;
      const { data: profile } = await supabase.from('profiles').select('email,name').eq('stripe_customer_id', customerId).single();
      await supabase.from('profiles').update({ subscription_status: 'past_due' }).eq('stripe_customer_id', customerId);
      if (profile?.email) await sendEmail(profile.email, 'payment_failed', { name: profile.name });
      break;
    }

    case 'customer.subscription.deleted': {
      const customerId = data.customer;
      await supabase.from('profiles').update({ subscription_status: 'cancelled', plan: 'free' }).eq('stripe_customer_id', customerId);
      break;
    }
  }

  return res.status(200).json({ received: true });
}

async function sendEmail(to, type, data) {
  if (!process.env.RESEND_API_KEY) return;
  const templates = {
    payment_confirmed: {
      subject: 'ð Welcome to Lumina AI â Your subscription is active!',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#8B6914);padding:2rem;text-align:center">
          <h1 style="margin:0;font-size:1.8rem">ð You're in!</h1>
        </div>
        <div style="padding:2rem">
          <p>Your <strong>${data.plan === 'homeschool' ? 'Homeschool' : 'Student'} Plan</strong> is now active.</p>
          <p>You now have full access to all Lumina AI features.</p>
          <a href="${process.env.SITE_URL}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none;margin-top:1rem">Start Learning â</a>
        </div></div>`
    },
    payment_failed: {
      subject: 'â ï¸ Lumina AI â Payment failed',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><p>Hi ${data.name},</p><p>We couldn't process your payment. Please update your payment method to continue accessing Lumina AI.</p><a href="${process.env.SITE_URL}" style="background:#C9A84C;color:#0D0F18;padding:.75rem 1.5rem;border-radius:8px;font-weight:700;text-decoration:none">Update Payment â</a></div>`
    }
  };

  const template = templates[type];
  if (!template) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Lumina AI <hello@luminaai.co.uk>', to, subject: template.subject, html: template.html })
  });
}
