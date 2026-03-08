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
      // Send confirmation email
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
      const { data: profile } = await supabase.from('profiles')
        .select('email,name').eq('stripe_customer_id', customerId).single();
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
  const templates = {
    payment_confirmed: {
      subject: 'Your Synaptiq subscription is active!',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#A07830);padding:2rem;text-align:center">
          <h1 style="margin:0;font-size:1.8rem;color:#08090E">You're in!</h1>
        </div>
        <div style="padding:2rem">
          <p>Your <strong>${data.plan === 'homeschool' ? 'Homeschool' : 'Student'} Plan</strong> is now active.</p>
          <p>You now have full access to all Synaptiq features.</p>
          <a href="${process.env.SITE_URL}" style="display:inline-block;background:#C9A84C;color:#08090E;padding:.875rem 2rem;border-radius:10px;font-weight:700;text-decoration:none;margin-top:1rem">Start Learning</a>
        </div></div>`
    },
    payment_failed: {
      subject: 'Synaptiq — Payment failed',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;padding:2rem">
        <p>Hi ${data.name},</p>
        <p>We couldn't process your payment. Please update your payment method to continue accessing Synaptiq.</p>
        <a href="${process.env.SITE_URL}" style="background:#C9A84C;color:#08090E;padding:.75rem 1.5rem;border-radius:10px;font-weight:700;text-decoration:none">Update Payment</a>
      </div>`
    }
  };
  const template = templates[type];
  if (!template) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Synaptiq <hello@synaptiqai.co.uk>', to, subject: template.subject, html: template.html })
  }).catch(() => {});
}
