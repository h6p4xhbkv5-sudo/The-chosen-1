import Stripe from 'stripe';
import { applyHeaders, isRateLimited, getIp } from './_lib.js';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  applyHeaders(res, 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!stripe) {
    return res.status(503).json({ error: 'Payments not configured. Please add STRIPE_SECRET_KEY to environment variables.' });
  }

  const ip = getIp(req);
  if (isRateLimited(`${ip}:stripe`, 10, 60_000)) {
    return res.status(429).json({ error: 'Too many requests — please try again later' });
  }

  const { action, plan, email } = req.body || {};
  const siteUrl = process.env.SITE_URL || 'https://synaptiq.vercel.app';

  const VALID_PLANS = ['student'];
  const prices = {
    student: process.env.STRIPE_PRICE_STUDENT
  };

  try {
    if (action === 'checkout') {
      if (!plan || !VALID_PLANS.includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan.' });
      }
      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
      }
      if (!prices[plan]) {
        return res.status(500).json({ error: 'Price ID not configured for this plan.' });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: email.toLowerCase().trim(),
        line_items: [{ price: prices[plan], quantity: 1 }],
        success_url: siteUrl + '?payment=success',
        cancel_url: siteUrl + '?payment=cancelled',
        allow_promotion_codes: true,
        subscription_data: {
          trial_period_days: 7,
          metadata: { plan, email: email.toLowerCase().trim() }
        },
        metadata: { plan }
      });
      return res.status(200).json({ url: session.url });
    }

    if (action === 'portal') {
      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
      }
      const customers = await stripe.customers.list({ email: email.toLowerCase().trim(), limit: 1 });
      if (!customers.data.length) return res.status(404).json({ error: 'No subscription found for this email.' });
      const session = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: siteUrl
      });
      return res.status(200).json({ url: session.url });
    }

    return res.status(400).json({ error: 'Unknown action. Valid: checkout, portal' });
  } catch (e) {
    const msg = /fetch|network|ECONNREFUSED|ETIMEDOUT|socket/i.test(e.message)
      ? 'Payment service temporarily unavailable. Please try again shortly.'
      : 'Payment processing error. Please try again or contact support.';
    return res.status(500).json({ error: msg });
  }
}
