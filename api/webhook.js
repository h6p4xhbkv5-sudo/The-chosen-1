import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Mark event as processed (idempotency). Returns false if already processed. */
async function markProcessed(supabase, eventId) {
  const { error } = await supabase
    .from('processed_webhooks')
    .insert({ id: eventId, processed_at: new Date().toISOString() });
  // Unique constraint violation = already processed
  return !error;
}

export default async function handler(req, res) {
  // Webhook endpoint has no CORS — only Stripe calls it
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).end();
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Idempotency: skip if we've already processed this event
  const isNew = await markProcessed(supabase, event.id);
  if (!isNew) {
    console.log(`Duplicate webhook skipped: ${event.id}`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  const data = event.data.object;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const email = data.customer_email;
        const plan = data.metadata?.plan || 'student';
        await supabase.from('profiles').update({
          plan,
          subscription_status: 'active',
          stripe_customer_id: data.customer,
          subscription_id: data.subscription,
        }).eq('email', email);
        await sendEmail(email, 'payment_confirmed', { plan });
        console.log(`✓ Subscription activated: ${email} → ${plan}`);
        break;
      }

      case 'invoice.payment_succeeded': {
        await supabase.from('profiles')
          .update({ subscription_status: 'active' })
          .eq('stripe_customer_id', data.customer);
        console.log(`✓ Payment renewed: ${data.customer}`);
        break;
      }

      case 'invoice.payment_failed': {
        const customerId = data.customer;
        const { data: profile } = await supabase
          .from('profiles').select('email,name').eq('stripe_customer_id', customerId).single();
        await supabase.from('profiles')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', customerId);
        if (profile?.email) {
          await sendEmail(profile.email, 'payment_failed', { name: profile.name });
        }
        console.log(`⚠ Payment failed: ${customerId}`);
        break;
      }

      case 'customer.subscription.deleted': {
        await supabase.from('profiles')
          .update({ subscription_status: 'cancelled', plan: 'free' })
          .eq('stripe_customer_id', data.customer);
        console.log(`✓ Subscription cancelled: ${data.customer}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`Error processing webhook ${event.id}:`, err.message);
    // Return 200 so Stripe doesn't retry — the event was received; log the error instead
    return res.status(200).json({ received: true, error: 'Processing error logged' });
  }

  return res.status(200).json({ received: true });
}

async function sendEmail(to, type, data) {
  if (!process.env.RESEND_API_KEY || !to) return;
  try {
    await fetch(`${process.env.SITE_URL}/api/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, email: to, name: data.name || 'there', stats: data }),
    });
  } catch (e) {
    console.error('sendEmail failed:', e.message);
  }
}
