import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

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
  if (!stripe || !supabase) return res.status(503).json({ error: 'Payments not configured' });
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

  // Idempotency: skip duplicate events
  const { data: existing } = await supabase.from('processed_webhooks')
    .select('event_id').eq('event_id', event.id).single();
  if (existing) return res.status(200).json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const email = data.customer_email;
        const plan = data.metadata?.plan || 'student';
        const { error: updateErr } = await supabase.from('profiles').update({
          plan,
          subscription_status: 'active',
          stripe_customer_id: data.customer,
          subscription_id: data.subscription
        }).eq('email', email);
        if (updateErr) console.error('Webhook profile update failed:', updateErr.message);
        await sendEmail(email, 'payment_confirmed', { stats: { plan } });
        break;
      }

      case 'invoice.payment_succeeded': {
        const customerId = data.customer;
        const { error: updateErr } = await supabase.from('profiles').update({
          subscription_status: 'active'
        }).eq('stripe_customer_id', customerId);
        if (updateErr) console.error('Webhook status update failed:', updateErr.message);
        break;
      }

      case 'invoice.payment_failed': {
        const customerId = data.customer;
        const { data: profile } = await supabase.from('profiles')
          .select('email,name').eq('stripe_customer_id', customerId).single();
        const { error: updateErr } = await supabase.from('profiles').update({
          subscription_status: 'past_due'
        }).eq('stripe_customer_id', customerId);
        if (updateErr) console.error('Webhook past_due update failed:', updateErr.message);
        if (profile?.email) {
          await sendEmail(profile.email, 'payment_failed', { name: profile.name, stats: {} });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const customerId = data.customer;
        const { error: updateErr } = await supabase.from('profiles').update({
          subscription_status: 'cancelled',
          plan: 'free'
        }).eq('stripe_customer_id', customerId);
        if (updateErr) console.error('Webhook cancellation update failed:', updateErr.message);
        break;
      }
    }
  } catch (e) {
    console.error('Webhook processing error:', e.message);
  }

  // Record event for idempotency
  try { await supabase.from('processed_webhooks').insert({ event_id: event.id }); } catch (_) {}

  return res.status(200).json({ received: true });
}

async function sendEmail(to, type, { name, stats } = {}) {
  if (!process.env.RESEND_API_KEY) return;
  const payload = { type, email: to, name: name || '', stats: stats || {} };
  await fetch(`${process.env.SITE_URL}/api/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {});
}
