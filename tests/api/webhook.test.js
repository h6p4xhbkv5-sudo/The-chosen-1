/**
 * Tests for the Stripe webhook handler (api/chat.js webhook section).
 *
 * Covered events:
 *   checkout.session.completed        – activates subscription, sends email
 *   invoice.payment_succeeded         – re-activates subscription after renewal
 *   invoice.payment_failed            – marks past_due, sends failure email
 *   customer.subscription.deleted     – cancels subscription
 *
 * Also covers:
 *   – Invalid webhook signature → 400
 *   – Non-POST method          → 405
 *   – sendEmail gracefully skips when RESEND_API_KEY is absent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── req/res stubs ────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-sig' },
    // Provide a readable stream-like interface for getRawBody()
    _rawBody: Buffer.from('{}'),
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
    statusCode: 200,
    body: null,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    end() { return this; },
  };
  return res;
}

// ─── Supabase mock factory ────────────────────────────────────────────────────

function makeSupabaseMock() {
  const updateMock = vi.fn().mockReturnThis();
  const eqMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const selectBuilder = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: eqMock })),
      select: vi.fn(() => selectBuilder),
    })),
    _eqMock: eqMock,
    _selectBuilder: selectBuilder,
  };
}

// ─── Handler extracted for testability ──────────────────────────────────────
// Mirrors the webhook section of api/chat.js with external deps injected.

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendEmail(to, type, data, { resendKey, siteUrl }) {
  if (!resendKey) return;
  const templates = {
    payment_confirmed: {
      subject: 'Welcome to Lumina AI – Your subscription is active!',
      html: `<p>Your ${data.plan} Plan is now active.</p>`,
    },
    payment_failed: {
      subject: 'Lumina AI – Payment failed',
      html: `<p>Hi ${data.name}, we could not process your payment.</p>`,
    },
  };
  const template = templates[type];
  if (!template) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Lumina AI <hello@luminaai.co.uk>', to, subject: template.subject, html: template.html }),
  });
}

async function webhookHandler(req, res, { stripe, supabase, env = {} }) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
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
        subscription_id: data.subscription,
      }).eq('email', email);
      await sendEmail(email, 'payment_confirmed', { plan }, env);
      break;
    }
    case 'invoice.payment_succeeded': {
      await supabase.from('profiles').update({ subscription_status: 'active' }).eq('stripe_customer_id', data.customer);
      break;
    }
    case 'invoice.payment_failed': {
      const { data: profile } = await supabase.from('profiles').select('email,name').eq('stripe_customer_id', data.customer).single();
      await supabase.from('profiles').update({ subscription_status: 'past_due' }).eq('stripe_customer_id', data.customer);
      if (profile?.email) await sendEmail(profile.email, 'payment_failed', { name: profile.name }, env);
      break;
    }
    case 'customer.subscription.deleted': {
      await supabase.from('profiles').update({ subscription_status: 'cancelled', plan: 'free' }).eq('stripe_customer_id', data.customer);
      break;
    }
  }

  return res.status(200).json({ received: true });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Stripe webhook handler', () => {
  let supabase;
  let stripe;
  let fetchMock;

  beforeEach(() => {
    supabase = makeSupabaseMock();

    stripe = {
      webhooks: {
        constructEvent: vi.fn(),
      },
    };

    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── HTTP method guard ──────────────────────────────────────────────────

  it('returns 405 for non-POST requests', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();

    await webhookHandler(req, res, { stripe, supabase });

    expect(res.statusCode).toBe(405);
  });

  // ── Signature validation ───────────────────────────────────────────────

  it('returns 400 when the Stripe signature is invalid', async () => {
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const req = makeReq({ headers: { 'stripe-signature': 'bad-sig' } });
    const res = makeRes();

    await webhookHandler(req, res, { stripe, supabase, env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' } });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  // ── checkout.session.completed ─────────────────────────────────────────

  describe('checkout.session.completed', () => {
    it('activates the subscription for the user email', async () => {
      const eqFn = vi.fn().mockResolvedValue({});
      const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
      supabase.from = vi.fn().mockReturnValue({ update: updateFn });

      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_email: 'alice@example.com',
            customer: 'cus_abc',
            subscription: 'sub_xyz',
            metadata: { plan: 'homeschool' },
          },
        },
      });

      const req = makeReq();
      const res = makeRes();

      await webhookHandler(req, res, {
        stripe, supabase,
        env: { STRIPE_WEBHOOK_SECRET: 'whsec_test', RESEND_API_KEY: '' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.received).toBe(true);
      expect(supabase.from).toHaveBeenCalledWith('profiles');
      expect(updateFn).toHaveBeenCalledWith({
        plan: 'homeschool',
        subscription_status: 'active',
        stripe_customer_id: 'cus_abc',
        subscription_id: 'sub_xyz',
      });
      expect(eqFn).toHaveBeenCalledWith('email', 'alice@example.com');
    });

    it('defaults plan to "student" when metadata.plan is absent', async () => {
      const eqFn = vi.fn().mockResolvedValue({});
      const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
      supabase.from = vi.fn().mockReturnValue({ update: updateFn });

      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_email: 'bob@example.com',
            customer: 'cus_bob',
            subscription: 'sub_bob',
            metadata: {},
          },
        },
      });

      const req = makeReq();
      const res = makeRes();

      await webhookHandler(req, res, {
        stripe, supabase,
        env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' },
      });

      expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ plan: 'student' }));
    });

    it('sends a payment_confirmed email via Resend when RESEND_API_KEY is set', async () => {
      supabase.from = vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }),
      });

      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_email: 'carol@example.com',
            customer: 'cus_carol',
            subscription: 'sub_carol',
            metadata: { plan: 'student' },
          },
        },
      });

      const req = makeReq();
      const res = makeRes();

      await webhookHandler(req, res, {
        stripe, supabase,
        env: { STRIPE_WEBHOOK_SECRET: 'whsec_test', RESEND_API_KEY: 'resend_key' },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('skips sending email when RESEND_API_KEY is not configured', async () => {
      supabase.from = vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }),
      });

      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_email: 'dave@example.com',
            customer: 'cus_dave',
            subscription: 'sub_dave',
            metadata: { plan: 'student' },
          },
        },
      });

      const req = makeReq();
      const res = makeRes();

      await webhookHandler(req, res, {
        stripe, supabase,
        env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' }, // no RESEND_API_KEY
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── invoice.payment_succeeded ──────────────────────────────────────────

  describe('invoice.payment_succeeded', () => {
    it('marks the profile subscription_status as active', async () => {
      const eqFn = vi.fn().mockResolvedValue({});
      const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
      supabase.from = vi.fn().mockReturnValue({ update: updateFn });

      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'invoice.payment_succeeded',
        data: { object: { customer: 'cus_renew' } },
      });

      const req = makeReq();
      const res = makeRes();

      await webhookHandler(req, res, { stripe, supabase, env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' } });

      expect(res.statusCode).toBe(200);
      expect(updateFn).toHaveBeenCalledWith({ subscription_status: 'active' });
      expect(eqFn).toHaveBeenCalledWith('stripe_customer_id', 'cus_renew');
    });
  });

  // ── invoice.payment_failed ─────────────────────────────────────────────

  describe('invoice.payment_failed', () => {
    it('marks the profile as past_due and sends a failure email', async () => {
      const eqFn = vi.fn().mockResolvedValue({});
      const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
      const singleFn = vi.fn().mockResolvedValue({ data: { email: 'eve@example.com', name: 'Eve' }, error: null });
      const selectEqFn = vi.fn().mockReturnValue({ single: singleFn });
      const selectFn = vi.fn().mockReturnValue({ eq: selectEqFn });

      supabase.from = vi.fn()
        .mockReturnValueOnce({ select: selectFn })   // first call – look up profile
        .mockReturnValue({ update: updateFn });       // subsequent calls – update

      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_failed' } },
      });

      const req = makeReq();
      const res = makeRes();

      await webhookHandler(req, res, {
        stripe, supabase,
        env: { STRIPE_WEBHOOK_SECRET: 'whsec_test', RESEND_API_KEY: 'resend_key' },
      });

      expect(res.statusCode).toBe(200);
      expect(updateFn).toHaveBeenCalledWith({ subscription_status: 'past_due' });
      // Resend should receive a payment_failed email
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('skips the email when no profile email is found', async () => {
      const eqFn = vi.fn().mockResolvedValue({});
      const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
      const singleFn = vi.fn().mockResolvedValue({ data: null, error: null }); // no profile
      const selectEqFn = vi.fn().mockReturnValue({ single: singleFn });
      const selectFn = vi.fn().mockReturnValue({ eq: selectEqFn });

      supabase.from = vi.fn()
        .mockReturnValueOnce({ select: selectFn })
        .mockReturnValue({ update: updateFn });

      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_ghost' } },
      });

      const req = makeReq();
      const res = makeRes();

      await webhookHandler(req, res, {
        stripe, supabase,
        env: { STRIPE_WEBHOOK_SECRET: 'whsec_test', RESEND_API_KEY: 'resend_key' },
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── customer.subscription.deleted ─────────────────────────────────────

  describe('customer.subscription.deleted', () => {
    it('sets subscription_status to cancelled and plan to free', async () => {
      const eqFn = vi.fn().mockResolvedValue({});
      const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
      supabase.from = vi.fn().mockReturnValue({ update: updateFn });

      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_gone' } },
      });

      const req = makeReq();
      const res = makeRes();

      await webhookHandler(req, res, { stripe, supabase, env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' } });

      expect(res.statusCode).toBe(200);
      expect(updateFn).toHaveBeenCalledWith({ subscription_status: 'cancelled', plan: 'free' });
      expect(eqFn).toHaveBeenCalledWith('stripe_customer_id', 'cus_gone');
    });
  });
});
