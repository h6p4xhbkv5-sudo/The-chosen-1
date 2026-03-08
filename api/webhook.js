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
      await supabase.from('profiles').update({
        plan,
        subscription_status: 'active',
        stripe_customer_id: data.customer,
        subscription_id: data.subscription
      }).eq('email', email);
      // Send confirmation email via internal endpoint
      await sendEmail(email, 'payment_confirmed', { plan });
      break;
    }

    case 'invoice.payment_succeeded': {
      const customerId = data.customer;
      await supabase.from('profiles').update({
        subscription_status: 'active'
      }).eq('stripe_customer_id', customerId);
      break;
    }

    case 'invoice.payment_failed': {
      const customerId = data.customer;
      // Idempotency: record webhook processing
      await supabase.from('processed_webhooks').insert({ event_id: event.id });
      // Look up profile
      const { data: profile } = await supabase.from('profiles')
        .select('email,name').eq('stripe_customer_id', customerId).single();
      // Update status
      await supabase.from('profiles').update({
        subscription_status: 'past_due'
      }).eq('stripe_customer_id', customerId);
      if (profile?.email) {
        await sendEmail(profile.email, 'payment_failed', { name: profile.name });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const customerId = data.customer;
      await supabase.from('profiles').update({
        subscription_status: 'cancelled',
        plan: 'free'
      }).eq('stripe_customer_id', customerId);
      break;
    }
  }

  return res.status(200).json({ received: true });
}

async function sendEmail(to, type, data) {
  if (!process.env.RESEND_API_KEY) return;
  const payload = { type, to, data };
  await fetch(`${process.env.SITE_URL}/api/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {});
}
