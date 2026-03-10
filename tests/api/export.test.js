/**
 * Tests for api/export.js — GDPR data export
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Supabase mock ─────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  const supabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };
  return { supabase };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.supabase }));

import handler from '../../api/export.js';

// ─── Helpers ───────────────────────────────────────────────────────────────
function makeRes() {
  const res = { _status: 200, _body: null, _headers: {} };
  res.status    = (code) => { res._status  = code; return res; };
  res.json      = (body) => { res._body    = body;  return res; };
  res.end       = ()     => res;
  res.setHeader = (k, v) => { res._headers[k] = v; return res; };
  return res;
}

function makeReq(token, method = 'GET') {
  return {
    method,
    headers: { authorization: token ? 'Bearer ' + token : undefined },
  };
}

function makeBuilder(resolution = { data: [], error: null }) {
  const b = { select: vi.fn(), eq: vi.fn() };
  const chain = { data: resolution.data, error: resolution.error };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(chain);
  return b;
}

describe('GET /api/export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 405 for POST', async () => {
    const res = makeRes();
    await handler(makeReq('tok', 'POST'), res);
    expect(res._status).toBe(405);
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const res = makeRes();
    await handler(makeReq(null, 'OPTIONS'), res);
    expect(res._status).toBe(200);
  });

  it('returns 401 with no token', async () => {
    const res = makeRes();
    await handler(makeReq(null), res);
    expect(res._status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    mocks.supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('bad') });
    const res = makeRes();
    await handler(makeReq('bad-token'), res);
    expect(res._status).toBe(401);
  });

  it('returns 200 JSON export on authenticated request', async () => {
    mocks.supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uid-1', email: 'u@example.com' } },
      error: null,
    });
    mocks.supabase.from.mockImplementation(() => makeBuilder({ data: [], error: null }));

    const res = makeRes();
    await handler(makeReq('valid-token'), res);

    expect(res._status).toBe(200);
    expect(res._body.user_id).toBe('uid-1');
    expect(res._body.email).toBe('u@example.com');
    expect(res._body.data).toBeDefined();
    expect(res._headers['Content-Disposition']).toMatch(/attachment/);
  });

  it('includes all expected table keys in the export', async () => {
    mocks.supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uid-2', email: 'b@example.com' } },
      error: null,
    });
    mocks.supabase.from.mockImplementation(() => makeBuilder({ data: [{ id: 'row' }], error: null }));

    const res = makeRes();
    await handler(makeReq('valid-token'), res);

    const tables = ['profiles', 'progress', 'notes', 'chat_history', 'flashcards', 'mistakes', 'exams', 'activity_log'];
    for (const t of tables) {
      expect(res._body.data[t]).toBeDefined();
    }
  });

  it('includes an exported_at timestamp', async () => {
    mocks.supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uid-3', email: 'c@example.com' } },
      error: null,
    });
    mocks.supabase.from.mockImplementation(() => makeBuilder({ data: [], error: null }));

    const res = makeRes();
    await handler(makeReq('valid-token'), res);

    expect(res._body.exported_at).toBeTruthy();
    expect(new Date(res._body.exported_at).getFullYear()).toBeGreaterThanOrEqual(2024);
  });
});
