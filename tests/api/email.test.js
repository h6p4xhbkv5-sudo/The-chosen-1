/**
 * Tests for api/email.js — imports and exercises the real handler.
 * No module mocks needed: the handler has no module-level dependencies.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import handler from '../../api/email.js';

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

describe('Email handler (api/email.js)', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.SITE_URL = 'https://lumina.example.com';
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SITE_URL;
    delete process.env.RESEND_API_KEY;
  });

  // ── Validation ────────────────────────────────────────────────────────────

  describe('input validation', () => {
    it('returns 400 for a missing email', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'welcome', name: 'Alice' }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 for a malformed email', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'welcome', email: 'not-valid', name: 'Alice' }), res);
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when name is empty', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'welcome', email: 'a@b.com', name: '' }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it('returns 400 for an unknown email type', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'newsletter', email: 'a@b.com', name: 'Dave' }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Unknown email type');
    });
  });

  // ── Templates (preview mode) ──────────────────────────────────────────────

  describe('welcome template', () => {
    it('includes the user name', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'welcome', email: 'a@b.com', name: 'Alice' }), res);
      expect(res.body.preview).toContain('Alice');
    });

    it('links to SITE_URL', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'welcome', email: 'a@b.com', name: 'Alice' }), res);
      expect(res.body.preview).toContain('https://lumina.example.com');
    });
  });

  describe('weekly template', () => {
    it('renders all four stat values', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'weekly', email: 'a@b.com', name: 'Bob', stats: { questions: 42, accuracy: 87, xp: 350, streak: 5 } }), res);
      expect(res.body.preview).toContain('42');
      expect(res.body.preview).toContain('87%');
      expect(res.body.preview).toContain('350');
      expect(res.body.preview).toContain('5');
    });

    it('defaults stats to 0 when omitted — no "undefined" in output', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'weekly', email: 'a@b.com', name: 'Bob' }), res);
      expect(res.body.preview).not.toContain('undefined');
    });
  });

  describe('exam_reminder template', () => {
    it('embeds the subject and days remaining', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'exam_reminder', email: 'a@b.com', name: 'Carol', stats: { subject: 'Physics', days: 14 } }), res);
      expect(res.body.preview).toContain('Physics');
      expect(res.body.preview).toContain('14');
    });
  });

  // ── Without RESEND_API_KEY ────────────────────────────────────────────────

  it('returns a preview and does not call fetch when RESEND_API_KEY is absent', async () => {
    const res = makeRes();
    await handler(makeReq({ type: 'welcome', email: 'a@b.com', name: 'Eve' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.note).toMatch(/RESEND_API_KEY/i);
    expect(res.body.preview).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── With RESEND_API_KEY ───────────────────────────────────────────────────

  describe('with RESEND_API_KEY set', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 'resend_key_123';
      fetchMock.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ id: 'email-001' }) });
    });

    it('calls Resend and returns the email id', async () => {
      const res = makeRes();
      await handler(makeReq({ type: 'welcome', email: 'frank@example.com', name: 'Frank' }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe('email-001');
    });

    it('sends to the correct recipient', async () => {
      await handler(makeReq({ type: 'welcome', email: 'g@g.com', name: 'Grace' }), makeRes());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toBe('g@g.com');
    });

    it('always sends from hello@luminaai.co.uk', async () => {
      await handler(makeReq({ type: 'weekly', email: 'h@h.com', name: 'Hank', stats: {} }), makeRes());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toBe('Lumina AI <hello@luminaai.co.uk>');
    });

    it('returns 500 when the Resend call throws', async () => {
      fetchMock.mockRejectedValue(new Error('Connection refused'));
      const res = makeRes();
      await handler(makeReq({ type: 'welcome', email: 'err@example.com', name: 'Err' }), res);
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toContain('Connection refused');
    });
  });
});
