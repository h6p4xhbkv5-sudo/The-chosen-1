import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, plan, email, successUrl, cancelUrl } = req.body;
  // Validate plan parameter
  const validPlans = ['student', 'homeschool'];
  if (plan && !validPlans.includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Must be "student" or "homeschool".' });
  }

  const prices = {
    student: process.env.STRIPE_PRICE_STUDENT,
    homeschool: process.env.STRIPE_PRICE_HOMESCHOOL
  };

  try {
    if (action === 'checkout') {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: email,
        line_items: [{ price: prices[plan] || prices.student, quantity: 1 }],
        success_url: (successUrl || process.env.SITE_URL) + '?payment=success',
        cancel_url: (cancelUrl || process.env.SITE_URL) + '?payment=cancelled',
        metadata: { plan }
      });
      return res.status(200).json({ url: session.url });
    }

    if (action === 'portal') {
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
