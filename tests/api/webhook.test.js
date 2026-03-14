/**
 * Tests for api/webhook.js — imports and exercises the real handler.
 * Both stripe and @supabase/supabase-js are mocked at module level.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const stripe = {
    webhooks: { constructEvent: vi.fn() },
  };
  const supabase = { from: vi.fn() };
  return { stripe, supabase };
});

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mocks.stripe),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mocks.supabase,
}));

import handler from '../../api/webhook.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBuilder(resolution = { data: null, error: null }) {
  const b = {
    _resolvedWith: resolution,
    then(res, rej) { return Promise.resolve(b._resolvedWith).then(res, rej); },
  };
  ['select', 'insert', 'update', 'delete', 'eq', 'single'].forEach(m => {
    b[m] = vi.fn().mockReturnValue(b);
  });
  return b;
}

function makeReq(overrides = {}) {
  const rawBody = Buffer.from('{}');
  return {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-sig' },
    _rawBody: rawBody,
    on(event, cb) {
      if (event === 'data') cb(this._rawBody);
      if (event === 'end') cb();
      return this;
    },
    ...overrides,
  };
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

function fakeEvent(type, obj) {
  return { id: 'evt_test_' + Date.now(), type, data: { object: obj } };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Stripe webhook handler (api/webhook.js)', () => {
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.SITE_URL = 'https://lumina.example.com';
    delete process.env.RESEND_API_KEY;
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    // Default: all from() calls get a builder that supports every method
    mocks.supabase.from.mockReturnValue(makeBuilder());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.SITE_URL;
    delete process.env.RESEND_API_KEY;
  });

  // ── HTTP method guard ─────────────────────────────────────────────────────

  it('returns 405 for non-POST requests', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  // ── Signature validation ──────────────────────────────────────────────────

  it('returns 400 when the Stripe signature is invalid', async () => {
    mocks.stripe.webhooks.constructEvent.mockImplementation(() => { throw new Error('No sig'); });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('passes the raw body, signature header, and env secret to constructEvent', async () => {
    mocks.stripe.webhooks.constructEvent.mockReturnValue(
      fakeEvent('invoice.payment_succeeded', { customer: 'cus_x' }),
    );
    mocks.supabase.from.mockReturnValue(makeBuilder());
    await handler(makeReq(), makeRes());
    expect(mocks.stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      expect.any(Buffer), 'valid-sig', 'whsec_test',
    );
  });

  // ── checkout.session.completed ────────────────────────────────────────────

  describe('checkout.session.completed', () => {
    it('activates the subscription for the customer email', async () => {
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('checkout.session.completed', {
        customer_email: 'alice@example.com', customer: 'cus_a', subscription: 'sub_a', metadata: { plan: 'student' },
      }));
      const builder = makeBuilder();
      mocks.supabase.from.mockReturnValue(builder);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.statusCode).toBe(200);
      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ subscription_status: 'active', plan: 'student' }));
      expect(builder.eq).toHaveBeenCalledWith('email', 'alice@example.com');
    });

    it('defaults plan to "student" when metadata.plan is absent', async () => {
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('checkout.session.completed', {
        customer_email: 'b@b.com', customer: 'cus_b', subscription: 'sub_b', metadata: {},
      }));
      const builder = makeBuilder();
      mocks.supabase.from.mockReturnValue(builder);
      await handler(makeReq(), makeRes());
      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ plan: 'student' }));
    });

    it('does not call Resend when RESEND_API_KEY is absent', async () => {
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('checkout.session.completed', {
        customer_email: 'c@c.com', customer: 'cus_c', subscription: 'sub_c', metadata: {},
      }));
      mocks.supabase.from.mockReturnValue(makeBuilder());
      await handler(makeReq(), makeRes());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends a payment_confirmed email when RESEND_API_KEY is set', async () => {
      process.env.RESEND_API_KEY = 'key';
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('checkout.session.completed', {
        customer_email: 'd@d.com', customer: 'cus_d', subscription: 'sub_d', metadata: { plan: 'homeschool' },
      }));
      mocks.supabase.from.mockReturnValue(makeBuilder());
      await handler(makeReq(), makeRes());
      // sendEmail now routes through the internal /api/email endpoint
      expect(fetchMock).toHaveBeenCalledWith(
        'https://lumina.example.com/api/email',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // ── invoice.payment_succeeded ─────────────────────────────────────────────

  describe('invoice.payment_succeeded', () => {
    it('marks subscription_status as active', async () => {
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('invoice.payment_succeeded', { customer: 'cus_renew' }));
      const builder = makeBuilder();
      mocks.supabase.from.mockReturnValue(builder);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.statusCode).toBe(200);
      expect(builder.update).toHaveBeenCalledWith({ subscription_status: 'active' });
      expect(builder.eq).toHaveBeenCalledWith('stripe_customer_id', 'cus_renew');
    });
  });

  // ── invoice.payment_failed ────────────────────────────────────────────────

  describe('invoice.payment_failed', () => {
    it('marks the profile as past_due', async () => {
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('invoice.payment_failed', { customer: 'cus_fail' }));
      const idempotencyBuilder = makeBuilder({ error: null }); // processed_webhooks.insert
      const selectBuilder      = makeBuilder({ data: { email: 'f@f.com', name: 'F' }, error: null });
      const updateBuilder      = makeBuilder();
      mocks.supabase.from
        .mockReturnValueOnce(idempotencyBuilder)
        .mockReturnValueOnce(selectBuilder)
        .mockReturnValueOnce(updateBuilder);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.statusCode).toBe(200);
      expect(updateBuilder.update).toHaveBeenCalledWith({ subscription_status: 'past_due' });
    });

    it('sends a failure email when the profile has an email', async () => {
      process.env.RESEND_API_KEY = 'key';
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('invoice.payment_failed', { customer: 'cus_f2' }));
      const idempotencyBuilder = makeBuilder({ error: null });
      const selectBuilder      = makeBuilder({ data: { email: 'late@x.com', name: 'Late' }, error: null });
      const updateBuilder      = makeBuilder();
      mocks.supabase.from
        .mockReturnValueOnce(idempotencyBuilder)
        .mockReturnValueOnce(selectBuilder)
        .mockReturnValueOnce(updateBuilder);
      await handler(makeReq(), makeRes());
      // sendEmail routes through the internal /api/email endpoint
      expect(fetchMock).toHaveBeenCalledWith(
        'https://lumina.example.com/api/email',
        expect.any(Object),
      );
    });

    it('skips the email when no profile is found', async () => {
      process.env.RESEND_API_KEY = 'key';
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('invoice.payment_failed', { customer: 'cus_ghost' }));
      const idempotencyBuilder = makeBuilder({ error: null });
      const selectBuilder      = makeBuilder({ data: null, error: null });
      const updateBuilder      = makeBuilder();
      mocks.supabase.from
        .mockReturnValueOnce(idempotencyBuilder)
        .mockReturnValueOnce(selectBuilder)
        .mockReturnValueOnce(updateBuilder);
      await handler(makeReq(), makeRes());
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── customer.subscription.deleted ────────────────────────────────────────

  describe('customer.subscription.deleted', () => {
    it('sets status to cancelled and plan to free', async () => {
      mocks.stripe.webhooks.constructEvent.mockReturnValue(fakeEvent('customer.subscription.deleted', { customer: 'cus_gone' }));
      const builder = makeBuilder();
      mocks.supabase.from.mockReturnValue(builder);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.statusCode).toBe(200);
      expect(builder.update).toHaveBeenCalledWith({ subscription_status: 'cancelled', plan: 'free' });
      expect(builder.eq).toHaveBeenCalledWith('stripe_customer_id', 'cus_gone');
    });
  });
});
