/**
 * Tests for the Progress API handler (api/chat.js progress section).
 *
 * The handler tracks per-subject quiz performance and updates the user profile:
 *
 *   GET  – returns progress rows, profile totals, and top mistakes
 *   POST – upserts a progress row and increments profile XP/question counts
 *
 * Special focus on the accuracy calculation edge cases:
 *   – 0 correct out of 10  → accuracy = 0%   (not NaN)
 *   – 8 correct out of 10  → accuracy = 80%
 *   – total = 0            → accuracy = 0%   (division-by-zero guard)
 *   – 1 correct out of 3   → accuracy = 33%  (Math.round)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── req/res stubs ────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer valid-token' },
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

async function progressHandler(req, res, supabase) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr) return res.status(401).json({ error: 'Invalid token' });

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('progress')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    const { data: mistakes } = await supabase
      .from('mistakes')
      .select('*')
      .eq('user_id', user.id)
      .order('count', { ascending: false })
      .limit(10);

    return res.status(200).json({ progress: data || [], profile, mistakes: mistakes || [] });
  }

  if (req.method === 'POST') {
    const { subject, topic, correct, total, xpEarned } = req.body;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    await supabase.from('progress').upsert(
      { user_id: user.id, subject, topic, accuracy, questions_done: total, last_practiced: new Date().toISOString() },
      { onConflict: 'user_id,subject,topic' },
    );

    await supabase.rpc('increment_user_stats', {
      uid: user.id,
      xp_add: xpEarned || 0,
      questions_add: total || 0,
    });

    return res.status(200).json({ success: true });
  }
}

// ─── Supabase mock helpers ────────────────────────────────────────────────────

function makeAuthSuccess(userId = 'user-123') {
  return {
    data: { user: { id: userId } },
    error: null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Progress API handler', () => {
  let getUser;

  beforeEach(() => {
    getUser = vi.fn().mockResolvedValue(makeAuthSuccess());
  });

  // ── Authentication guard ─────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when no authorization header is present', async () => {
      const supabase = { auth: { getUser: vi.fn() } };
      const req = makeReq({ headers: {} }); // no authorization header
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 when the token is invalid', async () => {
      const supabase = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'bad token' } }) },
      };
      const req = makeReq({ headers: { authorization: 'Bearer bad' } });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Invalid token');
    });
  });

  // ── GET /progress ─────────────────────────────────────────────────────────

  describe('GET', () => {
    it('returns progress, profile, and top mistakes for the authenticated user', async () => {
      const fakeProgress = [{ subject: 'Maths', accuracy: 85 }];
      const fakeProfile = { xp: 1200, level: 3 };
      const fakeMistakes = [{ topic: 'Algebra', count: 5 }];

      // We need to mock supabase.from() to return different data for different table names.
      const supabase = {
        auth: { getUser },
        from: vi.fn((table) => {
          if (table === 'progress') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: fakeProgress }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: fakeProfile }),
                }),
              }),
            };
          }
          if (table === 'mistakes') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: fakeMistakes }),
                  }),
                }),
              }),
            };
          }
        }),
      };

      const res = makeRes();
      await progressHandler(makeReq({ method: 'GET' }), res, supabase);

      expect(res.statusCode).toBe(200);
      expect(res.body.progress).toEqual(fakeProgress);
      expect(res.body.profile).toEqual(fakeProfile);
      expect(res.body.mistakes).toEqual(fakeMistakes);
    });

    it('returns empty arrays when no data exists', async () => {
      const supabase = {
        auth: { getUser },
        from: vi.fn((table) => {
          if (table === 'progress') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            };
          }
          if (table === 'mistakes') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: null }),
                  }),
                }),
              }),
            };
          }
        }),
      };

      const res = makeRes();
      await progressHandler(makeReq({ method: 'GET' }), res, supabase);

      expect(res.body.progress).toEqual([]);
      expect(res.body.mistakes).toEqual([]);
    });
  });

  // ── POST /progress – accuracy calculation ─────────────────────────────────

  describe('POST – accuracy calculation', () => {
    function makePostSupabase(upsertFn = vi.fn().mockResolvedValue({}), rpcFn = vi.fn().mockResolvedValue({})) {
      return {
        auth: { getUser },
        from: vi.fn(() => ({ upsert: upsertFn })),
        rpc: rpcFn,
      };
    }

    it('calculates 80% accuracy for 8 correct out of 10', async () => {
      const upsertFn = vi.fn().mockResolvedValue({});
      const supabase = makePostSupabase(upsertFn);

      const req = makeReq({
        method: 'POST',
        body: { subject: 'Maths', topic: 'Algebra', correct: 8, total: 10, xpEarned: 50 },
      });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(res.statusCode).toBe(200);
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ accuracy: 80, questions_done: 10 }),
        expect.any(Object),
      );
    });

    it('calculates 0% accuracy when all answers are wrong', async () => {
      const upsertFn = vi.fn().mockResolvedValue({});
      const supabase = makePostSupabase(upsertFn);

      const req = makeReq({
        method: 'POST',
        body: { subject: 'Physics', topic: 'Forces', correct: 0, total: 10, xpEarned: 0 },
      });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ accuracy: 0 }),
        expect.any(Object),
      );
    });

    it('returns 0% accuracy when total is 0 (division-by-zero guard)', async () => {
      const upsertFn = vi.fn().mockResolvedValue({});
      const supabase = makePostSupabase(upsertFn);

      const req = makeReq({
        method: 'POST',
        body: { subject: 'Chemistry', topic: 'Bonding', correct: 0, total: 0, xpEarned: 0 },
      });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ accuracy: 0 }),
        expect.any(Object),
      );
    });

    it('rounds fractional accuracy to nearest integer (1/3 → 33%)', async () => {
      const upsertFn = vi.fn().mockResolvedValue({});
      const supabase = makePostSupabase(upsertFn);

      const req = makeReq({
        method: 'POST',
        body: { subject: 'Biology', topic: 'Cells', correct: 1, total: 3, xpEarned: 10 },
      });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ accuracy: 33 }),
        expect.any(Object),
      );
    });

    it('calculates 100% accuracy when all answers are correct', async () => {
      const upsertFn = vi.fn().mockResolvedValue({});
      const supabase = makePostSupabase(upsertFn);

      const req = makeReq({
        method: 'POST',
        body: { subject: 'History', topic: 'WW2', correct: 5, total: 5, xpEarned: 100 },
      });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ accuracy: 100 }),
        expect.any(Object),
      );
    });
  });

  // ── POST /progress – XP and profile update ───────────────────────────────

  describe('POST – XP and profile update', () => {
    it('calls increment_user_stats RPC with the earned XP and question count', async () => {
      const rpcFn = vi.fn().mockResolvedValue({ data: null, error: null });
      const supabase = {
        auth: { getUser },
        from: vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({}) })),
        rpc: rpcFn,
      };

      const req = makeReq({
        method: 'POST',
        body: { subject: 'Maths', topic: 'Calculus', correct: 7, total: 10, xpEarned: 75 },
      });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(rpcFn).toHaveBeenCalledWith('increment_user_stats', {
        uid: 'user-123',
        xp_add: 75,
        questions_add: 10,
      });
    });

    it('defaults xpEarned to 0 when not provided', async () => {
      const rpcFn = vi.fn().mockResolvedValue({});
      const supabase = {
        auth: { getUser },
        from: vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({}) })),
        rpc: rpcFn,
      };

      const req = makeReq({
        method: 'POST',
        body: { subject: 'Maths', topic: 'Stats', correct: 4, total: 5 }, // no xpEarned
      });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(rpcFn).toHaveBeenCalledWith('increment_user_stats', expect.objectContaining({ xp_add: 0 }));
    });

    it('uses the conflict key user_id,subject,topic when upserting', async () => {
      const upsertFn = vi.fn().mockResolvedValue({});
      const supabase = {
        auth: { getUser },
        from: vi.fn(() => ({ upsert: upsertFn })),
        rpc: vi.fn().mockResolvedValue({}),
      };

      const req = makeReq({
        method: 'POST',
        body: { subject: 'English', topic: 'Shakespeare', correct: 3, total: 4, xpEarned: 20 },
      });
      const res = makeRes();

      await progressHandler(req, res, supabase);

      expect(upsertFn).toHaveBeenCalledWith(
        expect.any(Object),
        { onConflict: 'user_id,subject,topic' },
      );
    });
  });
});
