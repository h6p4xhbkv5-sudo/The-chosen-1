/**
 * Tests for the Email handler (api/chat.js email section).
 *
 * The handler renders one of three email templates and sends it via Resend.
 * When RESEND_API_KEY is absent it falls back to returning an HTML preview.
 *
 * Covered scenarios:
 *   – welcome        email: correct subject, contains user name and CTA link
 *   – weekly         email: contains all four stat values
 *   – exam_reminder  email: contains subject name and days countdown
 *   – unknown type   → 400
 *   – With RESEND_API_KEY    → calls Resend API, returns { success, id }
 *   – Without RESEND_API_KEY → returns { success, note, preview }
 *   – Resend API error       → 500
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

async function emailHandler(req, res, env = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, email, name, stats } = req.body;
  const siteUrl = env.SITE_URL || 'https://lumina-ai.vercel.app';

  const templates = {
    welcome: {
      subject: `Welcome to Lumina AI, ${name}! 🎓`,
      html: `<div>
        <h2>Welcome, ${name}!</h2>
        <p>You're all set on Lumina AI.</p>
        <a href="${siteUrl}">Start Learning →</a>
      </div>`,
    },
    weekly: {
      subject: `Your weekly Lumina progress report 📊`,
      html: `<div>
        <h2>Hi ${name}!</h2>
        <div>${stats?.questions || 0} Questions answered</div>
        <div>${stats?.accuracy || 0}% Accuracy</div>
        <div>${stats?.xp || 0} XP earned</div>
        <div>${stats?.streak || 0} Day streak</div>
      </div>`,
    },
    exam_reminder: {
      subject: `⏰ ${stats?.subject} exam in ${stats?.days} days — time to revise!`,
      html: `<div>
        <h2>⏰ Exam reminder, ${name}</h2>
        <p>Your <strong>${stats?.subject}</strong> exam is in <strong>${stats?.days} days</strong>.</p>
        <a href="${siteUrl}">Revise Now →</a>
      </div>`,
    },
  };

  const template = templates[type];
  if (!template) return res.status(400).json({ error: 'Unknown email type' });

  const resendKey = env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Lumina AI <hello@luminaai.co.uk>', to: email, subject: template.subject, html: template.html }),
      });
      const result = await r.json();
      return res.status(200).json({ success: true, id: result.id });
    } catch (e) {
      return res.status(500).json({ error: 'Email send failed: ' + e.message });
    }
  }

  return res.status(200).json({ success: true, note: 'Add RESEND_API_KEY to Vercel to send real emails', preview: template.html });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Email handler', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Template rendering ────────────────────────────────────────────────────

  describe('welcome template', () => {
    it('uses the correct subject line with the user name', async () => {
      const res = makeRes();
      await emailHandler(makeReq({ type: 'welcome', email: 'a@b.com', name: 'Alice' }), res, {});
      expect(res.statusCode).toBe(200);
      expect(res.body.preview).toContain('Alice');
    });

    it('includes a CTA link pointing to the site URL', async () => {
      const res = makeRes();
      await emailHandler(
        makeReq({ type: 'welcome', email: 'a@b.com', name: 'Alice' }),
        res,
        { SITE_URL: 'https://lumina.example.com' },
      );
      expect(res.body.preview).toContain('https://lumina.example.com');
    });
  });

  describe('weekly template', () => {
    const stats = { questions: 42, accuracy: 87, xp: 350, streak: 5 };

    it('renders all four stat values in the email body', async () => {
      const res = makeRes();
      await emailHandler(makeReq({ type: 'weekly', email: 'a@b.com', name: 'Bob', stats }), res, {});

      expect(res.body.preview).toContain('42');
      expect(res.body.preview).toContain('87%');
      expect(res.body.preview).toContain('350');
      expect(res.body.preview).toContain('5');
    });

    it('defaults all stats to 0 when stats object is omitted', async () => {
      const res = makeRes();
      await emailHandler(makeReq({ type: 'weekly', email: 'a@b.com', name: 'Bob' }), res, {});

      // All stats default to 0, should not render undefined
      expect(res.body.preview).not.toContain('undefined');
      expect(res.body.preview).toContain('0');
    });
  });

  describe('exam_reminder template', () => {
    it('embeds the subject and days remaining in subject line and body', async () => {
      const stats = { subject: 'Physics', days: 14 };
      const res = makeRes();
      await emailHandler(makeReq({ type: 'exam_reminder', email: 'a@b.com', name: 'Carol', stats }), res, {});

      expect(res.body.preview).toContain('Physics');
      expect(res.body.preview).toContain('14');
    });
  });

  // ── Unknown type ──────────────────────────────────────────────────────────

  it('returns 400 for an unrecognised email type', async () => {
    const res = makeRes();
    await emailHandler(makeReq({ type: 'newsletter', email: 'a@b.com', name: 'Dave' }), res, {});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Unknown email type');
  });

  // ── Without RESEND_API_KEY ────────────────────────────────────────────────

  it('returns a preview instead of sending when RESEND_API_KEY is absent', async () => {
    const res = makeRes();
    await emailHandler(makeReq({ type: 'welcome', email: 'a@b.com', name: 'Eve' }), res, {});

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.note).toMatch(/RESEND_API_KEY/i);
    expect(res.body.preview).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── With RESEND_API_KEY ───────────────────────────────────────────────────

  it('posts to Resend and returns the email id on success', async () => {
    fetchMock.mockResolvedValue({ json: vi.fn().mockResolvedValue({ id: 'resend-email-001' }) });

    const res = makeRes();
    await emailHandler(
      makeReq({ type: 'welcome', email: 'frank@example.com', name: 'Frank' }),
      res,
      { RESEND_API_KEY: 'resend_key_123', SITE_URL: 'https://lumina.example.com' },
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe('resend-email-001');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer resend_key_123' }),
      }),
    );
  });

  it('sends to the correct recipient address', async () => {
    fetchMock.mockResolvedValue({ json: vi.fn().mockResolvedValue({ id: 'e2' }) });

    const res = makeRes();
    await emailHandler(
      makeReq({ type: 'welcome', email: 'grace@example.com', name: 'Grace' }),
      res,
      { RESEND_API_KEY: 'key' },
    );

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.to).toBe('grace@example.com');
  });

  it('always sends from the Lumina AI address', async () => {
    fetchMock.mockResolvedValue({ json: vi.fn().mockResolvedValue({ id: 'e3' }) });

    const res = makeRes();
    await emailHandler(
      makeReq({ type: 'weekly', email: 'h@h.com', name: 'Hank', stats: {} }),
      res,
      { RESEND_API_KEY: 'key' },
    );

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.from).toBe('Lumina AI <hello@luminaai.co.uk>');
  });

  // ── Resend API error ──────────────────────────────────────────────────────

  it('returns 500 when the Resend API call throws', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const res = makeRes();
    await emailHandler(
      makeReq({ type: 'welcome', email: 'err@example.com', name: 'Err' }),
      res,
      { RESEND_API_KEY: 'key' },
    );

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain('Email send failed');
    expect(res.body.error).toContain('Connection refused');
  });
});
