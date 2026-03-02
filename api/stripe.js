import Stripe from 'stripe';
import { applyHeaders, isRateLimited, getIp } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PLANS = ['student', 'homeschool'];

export default async function handler(req, res) {
  applyHeaders(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Payment service not configured' });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Rate limit: 20 per IP per hour (Stripe has its own limits too)
  if (isRateLimited(`${getIp(req)}:stripe`, 20, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { action, plan, email } = req.body || {};

  const prices = {
    student: process.env.STRIPE_PRICE_STUDENT,
    homeschool: process.env.STRIPE_PRICE_HOMESCHOOL,
  };

  // Always build URLs from SITE_URL — never trust client-supplied redirect URLs
  const siteUrl = process.env.SITE_URL || '';

  if (action === 'checkout') {
    if (!plan || !VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan. Must be student or homeschool' });
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (!prices[plan]) return res.status(500).json({ error: `Missing price ID for plan: ${plan}` });

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: email,
        line_items: [{ price: prices[plan], quantity: 1 }],
        success_url: `${siteUrl}?payment=success`,
        cancel_url: `${siteUrl}?payment=cancelled`,
        metadata: { plan },
      });
      return res.status(200).json({ url: session.url });
    } catch (e) {
      return res.status(500).json({ error: 'Could not create checkout session' });
    }
  }

  if (action === 'portal') {
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    try {
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (!customers.data.length) return res.status(404).json({ error: 'No subscription found' });
      const session = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: siteUrl,
      });
      return res.status(200).json({ url: session.url });
    } catch (e) {
      return res.status(500).json({ error: 'Could not create billing portal session' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
