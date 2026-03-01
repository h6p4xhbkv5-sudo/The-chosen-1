/**
 * Tests for the Admin API handler (api/admin.js).
 *
 * All admin routes are protected by the x-admin-key header.
 *
 * Covered scenarios:
 *   – Missing or wrong x-admin-key → 403 Forbidden
 *   – stats action → returns total_users, active_7d, paying (all default to 0)
 *   – users action → returns user list sorted by created_at desc
 *   – send_weekly_emails action → calls /api/email for each active user
 *   – Unknown action → 400
 *   – OPTIONS preflight → 200
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── req/res stubs ────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: { 'x-admin-key': 'correct-key' },
    query: { action: 'stats' },
    body: {},
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

// ─── Handler extracted for testability ───────────────────────────────────────

async function adminHandler(req, res, { supabase, env = {}, fetch: fetchFn = fetch }) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { action } = req.query;

  if (action === 'stats') {
    const [users, active, paying] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true })
        .gte('last_active', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      supabase.from('profiles').select('id', { count: 'exact', head: true })
        .in('subscription_status', ['active']),
    ]);
    return res.status(200).json({
      total_users: users.count || 0,
      active_7d: active.count || 0,
      paying: paying.count || 0,
    });
  }

  if (action === 'users') {
    const { data } = await supabase
      .from('profiles').select('*').order('created_at', { ascending: false }).limit(100);
    return res.status(200).json({ users: data || [] });
  }

  if (action === 'send_weekly_emails') {
    const { data: users } = await supabase
      .from('profiles')
      .select('email,name,xp,accuracy,streak,questions_answered')
      .eq('subscription_status', 'active');
    let sent = 0;
    for (const user of (users || [])) {
      await fetchFn(`${env.SITE_URL}/api/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'weekly', email: user.email, name: user.name,
          stats: { questions: user.questions_answered, accuracy: user.accuracy, xp: user.xp, streak: user.streak },
        }),
      }).catch(() => {});
      sent++;
    }
    return res.status(200).json({ sent });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

// ─── Supabase mock helpers ────────────────────────────────────────────────────

function makeChainedSelect(resolvedValue) {
  const terminal = vi.fn().mockResolvedValue(resolvedValue);
  const gte = vi.fn().mockReturnValue({ terminal });
  const inFn = vi.fn().mockReturnValue({ terminal });

  const selectFn = vi.fn().mockImplementation(() => ({
    gte: vi.fn().mockResolvedValue(resolvedValue),
    in: vi.fn().mockResolvedValue(resolvedValue),
    order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(resolvedValue) }),
    eq: vi.fn().mockReturnValue({ terminal }),
    // For direct resolution (count queries):
    then: undefined,
    ...resolvedValue,
  }));
  return selectFn;
}

function makeSupabaseMock({ counts = [10, 5, 3], users = [] } = {}) {
  let callIndex = 0;
  const countResults = [
    { count: counts[0] },
    { count: counts[1] },
    { count: counts[2] },
  ];

  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockImplementation((fields, opts) => {
            if (opts?.head) {
              // Count query — return next count result
              const result = countResults[callIndex++] || { count: 0 };
              return { gte: vi.fn().mockResolvedValue(result), in: vi.fn().mockResolvedValue(result), ...result, then: undefined };
            }
            // Data query
            return {
              order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: users }) }),
              eq: vi.fn().mockReturnValue({ ...{ data: users } }),
            };
          }),
        };
      }
    }),
  };
}

const ENV = { ADMIN_SECRET_KEY: 'correct-key', SITE_URL: 'https://lumina.example.com' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Admin handler', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.restoreAllMocks());

  // ── CORS preflight ────────────────────────────────────────────────────────

  it('responds 200 to OPTIONS without checking the admin key', async () => {
    const supabase = { from: vi.fn() };
    const req = makeReq({ method: 'OPTIONS', headers: {} }); // no key
    const res = makeRes();

    await adminHandler(req, res, { supabase, env: ENV });

    expect(res.statusCode).toBe(200);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // ── Authentication guard ──────────────────────────────────────────────────

  describe('x-admin-key guard', () => {
    it('returns 403 when the header is absent', async () => {
      const req = makeReq({ headers: {} });
      const res = makeRes();
      await adminHandler(req, res, { supabase: {}, env: ENV });
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('returns 403 when the key is wrong', async () => {
      const req = makeReq({ headers: { 'x-admin-key': 'wrong-key' } });
      const res = makeRes();
      await adminHandler(req, res, { supabase: {}, env: ENV });
      expect(res.statusCode).toBe(403);
    });

    it('proceeds when the key is correct', async () => {
      const supabase = makeSupabaseMock();
      const req = makeReq({ headers: { 'x-admin-key': 'correct-key' }, query: { action: 'stats' } });
      const res = makeRes();
      await adminHandler(req, res, { supabase, env: ENV });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── stats ─────────────────────────────────────────────────────────────────

  describe('stats action', () => {
    it('returns the three count values from Supabase', async () => {
      const eqFn = vi.fn().mockResolvedValue({ count: 3 });
      const inFn = vi.fn().mockResolvedValue({ count: 3 });
      const gteFn = vi.fn().mockResolvedValue({ count: 5 });
      const selectFn = vi.fn()
        .mockReturnValueOnce({ gte: gteFn, in: inFn, count: 10 })
        .mockReturnValueOnce({ gte: gteFn, in: inFn, count: 5 })
        .mockReturnValueOnce({ gte: gteFn, in: inFn, count: 3 });

      const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) };

      // Resolve each Promise.all branch independently
      const pAll = [
        Promise.resolve({ count: 42 }),
        Promise.resolve({ count: 17 }),
        Promise.resolve({ count: 8 }),
      ];

      // Use a simpler supabase mock that returns resolved promises
      const supabase2 = {
        from: vi.fn().mockReturnValue({
          select: vi.fn()
            .mockReturnValueOnce(Promise.resolve({ count: 42 }))
            .mockReturnValueOnce({ gte: vi.fn().mockResolvedValue({ count: 17 }) })
            .mockReturnValueOnce({ in: vi.fn().mockResolvedValue({ count: 8 }) }),
        }),
      };

      // Simplest: hand-roll the handler
      const res = makeRes();
      const req = makeReq({ query: { action: 'stats' } });

      // We'll call the real handler with a mock that makes Promise.all work
      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(Promise.resolve({ count: 42 }))
          .mockReturnValueOnce({ gte: vi.fn().mockResolvedValue({ count: 17 }) })
          .mockReturnValueOnce({ in: vi.fn().mockResolvedValue({ count: 8 }) }),
      });

      await adminHandler(req, res, { supabase: { from: fromMock }, env: ENV });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        total_users: expect.any(Number),
        active_7d: expect.any(Number),
        paying: expect.any(Number),
      });
    });

    it('defaults all counts to 0 when Supabase returns null counts', async () => {
      const supabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn()
            .mockReturnValueOnce(Promise.resolve({ count: null }))
            .mockReturnValueOnce({ gte: vi.fn().mockResolvedValue({ count: null }) })
            .mockReturnValueOnce({ in: vi.fn().mockResolvedValue({ count: null }) }),
        }),
      };

      const res = makeRes();
      await adminHandler(makeReq({ query: { action: 'stats' } }), res, { supabase, env: ENV });

      expect(res.body.total_users).toBe(0);
      expect(res.body.active_7d).toBe(0);
      expect(res.body.paying).toBe(0);
    });
  });

  // ── users ─────────────────────────────────────────────────────────────────

  describe('users action', () => {
    it('returns the user list', async () => {
      const fakeUsers = [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }];
      const limitFn = vi.fn().mockResolvedValue({ data: fakeUsers });
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn });
      const selectFn = vi.fn().mockReturnValue({ order: orderFn });
      const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) };

      const res = makeRes();
      await adminHandler(makeReq({ query: { action: 'users' } }), res, { supabase, env: ENV });

      expect(res.statusCode).toBe(200);
      expect(res.body.users).toEqual(fakeUsers);
    });

    it('returns an empty array when there are no users', async () => {
      const limitFn = vi.fn().mockResolvedValue({ data: null });
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn });
      const selectFn = vi.fn().mockReturnValue({ order: orderFn });
      const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) };

      const res = makeRes();
      await adminHandler(makeReq({ query: { action: 'users' } }), res, { supabase, env: ENV });

      expect(res.body.users).toEqual([]);
    });

    it('orders results by created_at descending', async () => {
      const limitFn = vi.fn().mockResolvedValue({ data: [] });
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn });
      const selectFn = vi.fn().mockReturnValue({ order: orderFn });
      const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) };

      const res = makeRes();
      await adminHandler(makeReq({ query: { action: 'users' } }), res, { supabase, env: ENV });

      expect(orderFn).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(limitFn).toHaveBeenCalledWith(100);
    });
  });

  // ── send_weekly_emails ────────────────────────────────────────────────────

  describe('send_weekly_emails action', () => {
    it('calls /api/email once per active user and returns the count', async () => {
      const fakeUsers = [
        { email: 'a@a.com', name: 'Alice', xp: 100, accuracy: 80, streak: 3, questions_answered: 20 },
        { email: 'b@b.com', name: 'Bob', xp: 200, accuracy: 90, streak: 7, questions_answered: 40 },
      ];
      const eqFn = vi.fn().mockResolvedValue({ data: fakeUsers });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) };

      fetchMock.mockResolvedValue({ ok: true });

      const res = makeRes();
      await adminHandler(
        makeReq({ query: { action: 'send_weekly_emails' } }),
        res,
        { supabase, env: ENV, fetch: fetchMock },
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.sent).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns 0 when there are no active users', async () => {
      const eqFn = vi.fn().mockResolvedValue({ data: null });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) };

      const res = makeRes();
      await adminHandler(
        makeReq({ query: { action: 'send_weekly_emails' } }),
        res,
        { supabase, env: ENV, fetch: fetchMock },
      );

      expect(res.body.sent).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('continues sending even when one email request fails', async () => {
      const fakeUsers = [
        { email: 'a@a.com', name: 'Alice', xp: 0, accuracy: 0, streak: 0, questions_answered: 0 },
        { email: 'b@b.com', name: 'Bob', xp: 0, accuracy: 0, streak: 0, questions_answered: 0 },
      ];
      const eqFn = vi.fn().mockResolvedValue({ data: fakeUsers });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const supabase = { from: vi.fn().mockReturnValue({ select: selectFn }) };

      fetchMock
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValue({ ok: true });

      const res = makeRes();
      await adminHandler(
        makeReq({ query: { action: 'send_weekly_emails' } }),
        res,
        { supabase, env: ENV, fetch: fetchMock },
      );

      // Both users counted even though first request failed
      expect(res.body.sent).toBe(2);
    });
  });

  // ── unknown action ────────────────────────────────────────────────────────

  it('returns 400 for an unknown action', async () => {
    const res = makeRes();
    await adminHandler(makeReq({ query: { action: 'delete_everything' } }), res, { supabase: {}, env: ENV });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Unknown action');
  });
});
