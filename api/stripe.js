import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, plan, email } = req.body;

  const prices = {
    student: process.env.STRIPE_PRICE_STUDENT,
    homeschool: process.env.STRIPE_PRICE_HOMESCHOOL
  };

  try {
    if (action === 'checkout') {
      // Validate plan
      const validPlans = ['student', 'homeschool'];
      if (!plan || !validPlans.includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan. Must be "student" or "homeschool".' });
      }

      // Validate email
      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
      }

      // Check price ID exists
      if (!prices[plan]) {
        return res.status(500).json({ error: 'Missing price ID for the selected plan.' });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: email,
        line_items: [{ price: prices[plan], quantity: 1 }],
        success_url: process.env.SITE_URL + '?payment=success',
        cancel_url: process.env.SITE_URL + '?payment=cancelled',
        metadata: { plan }
      });
      return res.status(200).json({ url: session.url });
    }

    if (action === 'portal') {
      // Validate email
      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
      }

      const customers = await stripe.customers.list({ email, limit: 1 });
      if (!customers.data.length) return res.status(404).json({ error: 'No subscription found' });
      const session = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: process.env.SITE_URL
      });
      return res.status(200).json({ url: session.url });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
