/**
 * Tests for api/contact.js
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock fetch globally before importing handler
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import handler from '../../api/contact.js';

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body;  return res; };
  res.end    = ()      => res;
  res.setHeader = vi.fn();
  return res;
}

function makeReq(body = {}, method = 'POST') {
  return { method, body, headers: { 'x-forwarded-for': '1.2.3.4' } };
}

describe('POST /api/contact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
  });

  it('returns 405 for GET requests', async () => {
    const res = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(res._status).toBe(405);
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const res = makeRes();
    await handler(makeReq({}, 'OPTIONS'), res);
    expect(res._status).toBe(200);
  });

  it('returns 400 when name is missing', async () => {
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', message: 'Hello there, this is valid' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/name/i);
  });

  it('returns 400 for invalid email', async () => {
    const res = makeRes();
    await handler(makeReq({ name: 'Bob', email: 'not-an-email', message: 'Hello there' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/email/i);
  });

  it('returns 400 when message is too short', async () => {
    const res = makeRes();
    await handler(makeReq({ name: 'Bob', email: 'a@b.com', message: 'Hi' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/10 characters/i);
  });

  it('returns 400 for an invalid category', async () => {
    const res = makeRes();
    await handler(makeReq({ name: 'Bob', email: 'a@b.com', message: 'Valid message here', category: 'hacking' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/category/i);
  });

  it('sends email via Resend and returns 200 on valid input', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'email-123' }) });
    const res = makeRes();
    await handler(makeReq({ name: 'Alice', email: 'alice@example.com', message: 'This is a valid test message' }), res);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }));
  });

  it('HTML-escapes name in the outgoing email body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'xss-1' }) });
    await handler(makeReq({ name: '<script>alert(1)</script>', email: 'a@b.com', message: 'Valid message here' }), makeRes());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
  });

  it('sets reply_to to the submitter email', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await handler(makeReq({ name: 'Alice', email: 'alice@example.com', message: 'Valid message here' }), makeRes());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reply_to).toBe('alice@example.com');
  });

  it('returns 500 when Resend returns an error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Resend error' }) });
    const res = makeRes();
    await handler(makeReq({ name: 'Alice', email: 'alice@example.com', message: 'Valid message here again' }), res);
    expect(res._status).toBe(500);
  });

  it('acknowledges without sending when RESEND_API_KEY is absent', async () => {
    delete process.env.RESEND_API_KEY;
    const res = makeRes();
    await handler(makeReq({ name: 'Alice', email: 'alice@example.com', message: 'This is a valid test message' }), res);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
