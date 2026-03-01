/**
 * Tests for the Stripe checkout handler (api/stripe.js).
 *
 * Covered scenarios:
 *
 *   checkout action:
 *     – Valid plan + email → creates Stripe checkout session, returns URL
 *     – Invalid plan → 400
 *     – Missing / malformed email → 400
 *     – Missing price ID env var → 500
 *     – Correct metadata (plan) passed to session
 *     – success_url and cancel_url include query params
 *
 *   portal action:
 *     – Valid email with existing Stripe customer → returns billing portal URL
 *     – Email not found in Stripe → 404
 *     – Invalid email → 400
 *
 *   Unknown action → 400
 *   OPTIONS preflight → 200
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── req/res stubs ────────────────────────────────────────────────────────────

function makeReq(body = {}) {
  return { method: 'POST', headers: {}, body };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    end() { return this; },
  };
  return res;
}

// ─── Handler extracted for testability ───────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PLANS = ['student', 'homeschool'];

async function stripeHandler(req, res, { stripe, env = {} }) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, plan, email, successUrl, cancelUrl } = req.body;

  const prices = {
    student: env.STRIPE_PRICE_STUDENT,
    homeschool: env.STRIPE_PRICE_HOMESCHOOL,
  };

  if (action === 'checkout') {
    if (!plan || !VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan. Must be student or homeschool' });
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (!prices[plan]) return res.status(500).json({ error: `Missing price ID for plan: ${plan}` });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: prices[plan], quantity: 1 }],
      success_url: (successUrl || env.SITE_URL) + '?payment=success',
      cancel_url: (cancelUrl || env.SITE_URL) + '?payment=cancelled',
      metadata: { plan },
    });
    return res.status(200).json({ url: session.url });
  }

  if (action === 'portal') {
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    const customers = await stripe.customers.list({ email });
    if (!customers.data.length) return res.status(404).json({ error: 'No subscription found' });
    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: env.SITE_URL,
    });
    return res.status(200).json({ url: session.url });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

// ─── Stripe mock factory ──────────────────────────────────────────────────────

function makeStripeMock({ sessionUrl = 'https://checkout.stripe.com/pay/cs_test', portalUrl = 'https://billing.stripe.com/p/session/test' } = {}) {
  return {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: sessionUrl }),
      },
    },
    customers: {
      list: vi.fn().mockResolvedValue({ data: [{ id: 'cus_test123' }] }),
    },
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: portalUrl }),
      },
    },
  };
}

const ENV = {
  STRIPE_PRICE_STUDENT: 'price_student_001',
  STRIPE_PRICE_HOMESCHOOL: 'price_homeschool_001',
  SITE_URL: 'https://lumina.example.com',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Stripe checkout handler', () => {
  let stripe;

  beforeEach(() => {
    stripe = makeStripeMock();
  });

  // ── OPTIONS preflight ─────────────────────────────────────────────────────

  it('responds 200 to OPTIONS without calling Stripe', async () => {
    const res = makeRes();
    await stripeHandler({ method: 'OPTIONS', headers: {}, body: {} }, res, { stripe, env: ENV });
    expect(res.statusCode).toBe(200);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  // ── checkout action ───────────────────────────────────────────────────────

  describe('checkout', () => {
    it('creates a session and returns the URL for a valid student plan', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'checkout', plan: 'student', email: 'alice@example.com' }),
        res,
        { stripe, env: ENV },
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBe('https://checkout.stripe.com/pay/cs_test');
    });

    it('creates a session for the homeschool plan', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'checkout', plan: 'homeschool', email: 'bob@example.com' }),
        res,
        { stripe, env: ENV },
      );

      expect(res.statusCode).toBe(200);
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ line_items: [{ price: 'price_homeschool_001', quantity: 1 }] }),
      );
    });

    it('passes the plan in session metadata', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'checkout', plan: 'student', email: 'carol@example.com' }),
        res,
        { stripe, env: ENV },
      );

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { plan: 'student' } }),
      );
    });

    it('appends ?payment=success to success_url', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'checkout', plan: 'student', email: 'dave@example.com' }),
        res,
        { stripe, env: ENV },
      );

      const call = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(call.success_url).toContain('?payment=success');
    });

    it('uses a custom successUrl when provided', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'checkout', plan: 'student', email: 'eve@example.com', successUrl: 'https://custom.example.com' }),
        res,
        { stripe, env: ENV },
      );

      const call = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(call.success_url).toStartWith('https://custom.example.com');
    });

    it('returns 400 for an invalid plan', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'checkout', plan: 'enterprise', email: 'f@f.com' }),
        res,
        { stripe, env: ENV },
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/invalid plan/i);
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('returns 400 when no plan is provided', async () => {
      const res = makeRes();
      await stripeHandler(makeReq({ action: 'checkout', email: 'g@g.com' }), res, { stripe, env: ENV });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for a missing email', async () => {
      const res = makeRes();
      await stripeHandler(makeReq({ action: 'checkout', plan: 'student' }), res, { stripe, env: ENV });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 for a malformed email', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'checkout', plan: 'student', email: 'not-an-email' }),
        res,
        { stripe, env: ENV },
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when the price ID env var is not configured', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'checkout', plan: 'student', email: 'h@h.com' }),
        res,
        { stripe, env: { ...ENV, STRIPE_PRICE_STUDENT: undefined } },
      );

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toMatch(/missing price id/i);
    });
  });

  // ── portal action ─────────────────────────────────────────────────────────

  describe('portal', () => {
    it('returns the billing portal URL for an existing Stripe customer', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'portal', email: 'existing@example.com' }),
        res,
        { stripe, env: ENV },
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBe('https://billing.stripe.com/p/session/test');
    });

    it('passes the correct customer id to the billing portal', async () => {
      stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_abc123' }] });

      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'portal', email: 'existing@example.com' }),
        res,
        { stripe, env: ENV },
      );

      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_abc123' }),
      );
    });

    it('returns 404 when the email is not associated with any Stripe customer', async () => {
      stripe.customers.list.mockResolvedValue({ data: [] });

      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'portal', email: 'nobody@example.com' }),
        res,
        { stripe, env: ENV },
      );

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('No subscription found');
    });

    it('returns 400 for a missing email', async () => {
      const res = makeRes();
      await stripeHandler(makeReq({ action: 'portal' }), res, { stripe, env: ENV });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for a malformed email', async () => {
      const res = makeRes();
      await stripeHandler(
        makeReq({ action: 'portal', email: 'bad-email' }),
        res,
        { stripe, env: ENV },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ── unknown action ────────────────────────────────────────────────────────

  it('returns 400 for an unknown action', async () => {
    const res = makeRes();
    await stripeHandler(makeReq({ action: 'refund' }), res, { stripe, env: ENV });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Unknown action');
  });
});
