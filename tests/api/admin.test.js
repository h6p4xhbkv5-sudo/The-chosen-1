/**
 * Tests for api/admin.js — imports and exercises the real handler.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  const supabase = { from: vi.fn() };
  return { supabase };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mocks.supabase,
}));

import handler from '../../api/admin.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBuilder(resolution = { data: null, error: null, count: null }) {
  const b = {
    _resolvedWith: resolution,
    then(res, rej) { return Promise.resolve(b._resolvedWith).then(res, rej); },
  };
  ['select', 'insert', 'order', 'limit', 'range', 'eq', 'gte', 'in'].forEach(m => {
    b[m] = vi.fn().mockReturnValue(b);
  });
  return b;
}

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: { 'x-admin-key': 'secret' },
    query: { action: 'stats' },
    body: {},
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Admin handler (api/admin.js)', () => {
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SECRET_KEY = 'secret';
    process.env.SITE_URL = 'https://lumina.example.com';
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    mocks.supabase.from.mockReturnValue(makeBuilder());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADMIN_SECRET_KEY;
    delete process.env.SITE_URL;
  });

  // ── OPTIONS ───────────────────────────────────────────────────────────────

  it('responds 200 to OPTIONS without checking the admin key', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'OPTIONS', headers: {} }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.supabase.from).not.toHaveBeenCalled();
  });

  // ── Auth guard ────────────────────────────────────────────────────────────

  describe('x-admin-key guard', () => {
    it('returns 403 when the header is absent', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: {} }), res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('returns 403 for a wrong key', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { 'x-admin-key': 'wrong' } }), res);
      expect(res.statusCode).toBe(403);
    });

    it('proceeds when the correct key is supplied', async () => {
      // stats with three count calls
      mocks.supabase.from
        .mockReturnValueOnce(makeBuilder({ count: 5 }))
        .mockReturnValueOnce(makeBuilder({ count: 2 }))
        .mockReturnValueOnce(makeBuilder({ count: 1 }));
      const res = makeRes();
      await handler(makeReq({ headers: { 'x-admin-key': 'secret' } }), res);
      expect(res.statusCode).toBe(200);
    });
  });

  // ── stats ─────────────────────────────────────────────────────────────────

  describe('stats action', () => {
    it('returns total_users, active_7d, and paying from Supabase counts', async () => {
      mocks.supabase.from
        .mockReturnValueOnce(makeBuilder({ count: 42 }))
        .mockReturnValueOnce(makeBuilder({ count: 17 }))
        .mockReturnValueOnce(makeBuilder({ count: 8 }));

      const res = makeRes();
      await handler(makeReq({ query: { action: 'stats' } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        total_users: 42,
        active_7d: 17,
        paying: 8,
      });
    });

    it('defaults all counts to 0 when Supabase returns null', async () => {
      mocks.supabase.from
        .mockReturnValueOnce(makeBuilder({ count: null }))
        .mockReturnValueOnce(makeBuilder({ count: null }))
        .mockReturnValueOnce(makeBuilder({ count: null }));

      const res = makeRes();
      await handler(makeReq({ query: { action: 'stats' } }), res);

      expect(res.body.total_users).toBe(0);
      expect(res.body.active_7d).toBe(0);
      expect(res.body.paying).toBe(0);
    });
  });

  // ── users ─────────────────────────────────────────────────────────────────

  describe('users action', () => {
    it('returns the user list with pagination envelope', async () => {
      const fakeUsers = [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }];
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: fakeUsers, count: 2 }));

      const res = makeRes();
      await handler(makeReq({ query: { action: 'users' } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.users).toEqual(fakeUsers);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
    });

    it('returns an empty array when there are no users', async () => {
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: null, count: 0 }));

      const res = makeRes();
      await handler(makeReq({ query: { action: 'users' } }), res);

      expect(res.body.users).toEqual([]);
    });

    it('requests users ordered by created_at descending using range', async () => {
      const builder = makeBuilder({ data: [], count: 0 });
      mocks.supabase.from.mockReturnValue(builder);

      await handler(makeReq({ query: { action: 'users' } }), makeRes());

      expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(builder.range).toHaveBeenCalledWith(0, 49); // page 1, limit 50 → range(0, 49)
    });
  });

  // ── send_weekly_emails ────────────────────────────────────────────────────

  describe('send_weekly_emails action', () => {
    const users = [
      { email: 'a@a.com', name: 'Alice', xp: 100, accuracy: 80, streak: 3, questions_answered: 20 },
      { email: 'b@b.com', name: 'Bob',   xp: 200, accuracy: 90, streak: 7, questions_answered: 40 },
    ];

    it('calls /api/email once per active user and returns the count', async () => {
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: users }));

      const res = makeRes();
      await handler(makeReq({ query: { action: 'send_weekly_emails' } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.sent).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('posts to SITE_URL/api/email for each user', async () => {
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: [users[0]] }));

      await handler(makeReq({ query: { action: 'send_weekly_emails' } }), makeRes());

      expect(fetchMock).toHaveBeenCalledWith(
        'https://lumina.example.com/api/email',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns 0 when there are no active users', async () => {
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: null }));

      const res = makeRes();
      await handler(makeReq({ query: { action: 'send_weekly_emails' } }), res);

      expect(res.body.sent).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('continues and reports failures separately when one email request throws', async () => {
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: users }));
      fetchMock
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue({ ok: true });

      const res = makeRes();
      await handler(makeReq({ query: { action: 'send_weekly_emails' } }), res);

      expect(res.body.sent).toBe(1);
      expect(res.body.failed).toBe(1);
    });
  });

  // ── unknown action ────────────────────────────────────────────────────────

  it('returns 400 for an unknown action', async () => {
    const res = makeRes();
    await handler(makeReq({ query: { action: 'destroy' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Unknown action');
  });
});
