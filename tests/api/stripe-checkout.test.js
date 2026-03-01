/**
 * Tests for api/stripe.js — imports and exercises the real handler.
 * The stripe package is mocked at module level via vi.hoisted().
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const stripe = {
    checkout: {
      sessions: { create: vi.fn() },
    },
    customers: { list: vi.fn() },
    billingPortal: {
      sessions: { create: vi.fn() },
    },
  };
  return { stripe };
});

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mocks.stripe),
}));

import handler from '../../api/stripe.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body = {}) {
  return { method: 'POST', headers: {}, body };
}

function makeRes() {
  const res = {
    statusCode: 200, body: null,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    end() { return this; },
  };
  return res;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Stripe checkout handler (api/stripe.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_STUDENT    = 'price_student_001';
    process.env.STRIPE_PRICE_HOMESCHOOL = 'price_homeschool_001';
    process.env.SITE_URL                = 'https://lumina.example.com';

    mocks.stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test' });
    mocks.stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_test' }] });
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/session/test' });
  });

  afterEach(() => {
    delete process.env.STRIPE_PRICE_STUDENT;
    delete process.env.STRIPE_PRICE_HOMESCHOOL;
    delete process.env.SITE_URL;
  });

  // ── OPTIONS ───────────────────────────────────────────────────────────────

  it('responds 200 to OPTIONS without calling Stripe', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  // ── checkout action ───────────────────────────────────────────────────────

  describe('checkout', () => {
    it('returns the Stripe checkout URL for a valid student plan', async () => {
      const res = makeRes();
      await handler(makeReq({ action: 'checkout', plan: 'student', email: 'alice@example.com' }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBe('https://checkout.stripe.com/pay/cs_test');
    });

    it('uses the homeschool price ID for the homeschool plan', async () => {
      await handler(makeReq({ action: 'checkout', plan: 'homeschool', email: 'b@b.com' }), makeRes());
      expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ line_items: [{ price: 'price_homeschool_001', quantity: 1 }] }),
      );
    });

    it('passes the plan in session metadata', async () => {
      await handler(makeReq({ action: 'checkout', plan: 'student', email: 'c@c.com' }), makeRes());
      expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { plan: 'student' } }),
      );
    });

    it('appends ?payment=success to success_url', async () => {
      await handler(makeReq({ action: 'checkout', plan: 'student', email: 'd@d.com' }), makeRes());
      const call = mocks.stripe.checkout.sessions.create.mock.calls[0][0];
      expect(call.success_url).toContain('?payment=success');
    });

    it('uses a provided successUrl instead of SITE_URL', async () => {
      await handler(makeReq({ action: 'checkout', plan: 'student', email: 'e@e.com', successUrl: 'https://custom.example.com' }), makeRes());
      const call = mocks.stripe.checkout.sessions.create.mock.calls[0][0];
      expect(call.success_url).toStartWith('https://custom.example.com');
    });

    it('returns 400 for an invalid plan', async () => {
      const res = makeRes();
      await handler(makeReq({ action: 'checkout', plan: 'enterprise', email: 'f@f.com' }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/invalid plan/i);
      expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('returns 400 when no plan is provided', async () => {
      const res = makeRes();
      await handler(makeReq({ action: 'checkout', email: 'g@g.com' }), res);
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when email is missing', async () => {
      const res = makeRes();
      await handler(makeReq({ action: 'checkout', plan: 'student' }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 for a malformed email', async () => {
      const res = makeRes();
      await handler(makeReq({ action: 'checkout', plan: 'student', email: 'not-an-email' }), res);
      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when the price ID env var is missing', async () => {
      delete process.env.STRIPE_PRICE_STUDENT;
      const res = makeRes();
      await handler(makeReq({ action: 'checkout', plan: 'student', email: 'h@h.com' }), res);
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toMatch(/missing price id/i);
    });
  });

  // ── portal action ─────────────────────────────────────────────────────────

  describe('portal', () => {
    it('returns the billing portal URL for an existing customer', async () => {
      const res = makeRes();
      await handler(makeReq({ action: 'portal', email: 'existing@example.com' }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBe('https://billing.stripe.com/session/test');
    });

    it('passes the correct customer id to billingPortal.sessions.create', async () => {
      mocks.stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_abc123' }] });
      await handler(makeReq({ action: 'portal', email: 'e@e.com' }), makeRes());
      expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_abc123' }),
      );
    });

    it('returns 404 when no Stripe customer is found for the email', async () => {
      mocks.stripe.customers.list.mockResolvedValue({ data: [] });
      const res = makeRes();
      await handler(makeReq({ action: 'portal', email: 'nobody@example.com' }), res);
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('No subscription found');
    });

    it('returns 400 when email is missing', async () => {
      const res = makeRes();
      await handler(makeReq({ action: 'portal' }), res);
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for a malformed email', async () => {
      const res = makeRes();
      await handler(makeReq({ action: 'portal', email: 'bad-email' }), res);
      expect(res.statusCode).toBe(400);
    });
  });

  // ── unknown action ────────────────────────────────────────────────────────

  it('returns 400 for an unknown action', async () => {
    const res = makeRes();
    await handler(makeReq({ action: 'refund' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Unknown action');
  });
});
