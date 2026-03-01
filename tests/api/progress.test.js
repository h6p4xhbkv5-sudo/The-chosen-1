/**
 * Tests for api/progress.js — imports and exercises the real handler.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const supabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    rpc: vi.fn(),
  };
  return { supabase };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mocks.supabase,
}));

import handler from '../../api/progress.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBuilder(resolution = { data: null, error: null }) {
  const b = {
    _resolvedWith: resolution,
    then(res, rej) { return Promise.resolve(b._resolvedWith).then(res, rej); },
  };
  ['select', 'insert', 'upsert', 'eq', 'order', 'limit', 'single'].forEach(m => {
    b[m] = vi.fn().mockReturnValue(b);
  });
  return b;
}

function makeReq(overrides = {}) {
  return { method: 'GET', headers: { authorization: 'Bearer tok' }, body: {}, ...overrides };
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

describe('Progress handler (api/progress.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
    mocks.supabase.from.mockReturnValue(makeBuilder());
    mocks.supabase.rpc.mockResolvedValue({ data: null, error: null });
  });

  // ── Authentication guard ──────────────────────────────────────────────────

  it('returns 401 when no authorization header is present', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 for an invalid token', async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad JWT' } });
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer bad' } }), res);
    expect(res.statusCode).toBe(401);
  });

  // ── GET ───────────────────────────────────────────────────────────────────

  describe('GET', () => {
    it('returns progress, profile, and mistakes', async () => {
      const fakeProgress = [{ subject: 'Maths', accuracy: 80 }];
      const fakeProfile  = { xp: 600, level: 4 };
      const fakeMistakes = [{ topic: 'Algebra', count: 3 }];
      mocks.supabase.from
        .mockReturnValueOnce(makeBuilder({ data: fakeProgress }))
        .mockReturnValueOnce(makeBuilder({ data: fakeProfile }))
        .mockReturnValueOnce(makeBuilder({ data: fakeMistakes }));
      const res = makeRes();
      await handler(makeReq({ method: 'GET' }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.progress).toEqual(fakeProgress);
      expect(res.body.profile).toEqual(fakeProfile);
      expect(res.body.mistakes).toEqual(fakeMistakes);
    });

    it('returns empty arrays when there is no data', async () => {
      mocks.supabase.from
        .mockReturnValueOnce(makeBuilder({ data: null }))
        .mockReturnValueOnce(makeBuilder({ data: null }))
        .mockReturnValueOnce(makeBuilder({ data: null }));
      const res = makeRes();
      await handler(makeReq({ method: 'GET' }), res);
      expect(res.body.progress).toEqual([]);
      expect(res.body.mistakes).toEqual([]);
    });
  });

  // ── POST – accuracy calculation ───────────────────────────────────────────

  describe('POST – accuracy', () => {
    function post(body) {
      return makeReq({ method: 'POST', body: { subject: 'X', topic: 'Y', xpEarned: 0, ...body } });
    }

    it.each([
      [8, 10, 80],
      [0, 10, 0],
      [0, 0,  0],   // division-by-zero guard
      [1, 3,  33],  // rounded
      [5, 5,  100],
    ])('correct=%i / total=%i → accuracy=%i%%', async (correct, total, expected) => {
      const builder = makeBuilder();
      mocks.supabase.from.mockReturnValue(builder);
      await handler(post({ correct, total }), makeRes());
      expect(builder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ accuracy: expected }),
        expect.any(Object),
      );
    });
  });

  // ── POST – validation ─────────────────────────────────────────────────────

  describe('POST – input validation', () => {
    it('returns 400 when total is negative', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'POST', body: { subject: 'X', topic: 'Y', correct: 0, total: -1, xpEarned: 0 } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/total/i);
    });

    it('returns 400 when correct exceeds total', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'POST', body: { subject: 'X', topic: 'Y', correct: 5, total: 3, xpEarned: 0 } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/correct/i);
    });

    it('returns 400 when xpEarned is negative', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'POST', body: { subject: 'X', topic: 'Y', correct: 2, total: 5, xpEarned: -10 } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/xpEarned/i);
    });
  });

  // ── POST – RPC call ───────────────────────────────────────────────────────

  describe('POST – XP update', () => {
    it('calls increment_user_stats with correct args', async () => {
      mocks.supabase.from.mockReturnValue(makeBuilder());
      await handler(makeReq({ method: 'POST', body: { subject: 'Maths', topic: 'Calc', correct: 7, total: 10, xpEarned: 75 } }), makeRes());
      expect(mocks.supabase.rpc).toHaveBeenCalledWith('increment_user_stats', { uid: 'user-123', xp_add: 75, questions_add: 10 });
    });

    it('defaults xpEarned to 0 when omitted', async () => {
      mocks.supabase.from.mockReturnValue(makeBuilder());
      await handler(makeReq({ method: 'POST', body: { subject: 'X', topic: 'Y', correct: 3, total: 5 } }), makeRes());
      expect(mocks.supabase.rpc).toHaveBeenCalledWith('increment_user_stats', expect.objectContaining({ xp_add: 0 }));
    });

    it('upserts with conflict key user_id,subject,topic', async () => {
      const builder = makeBuilder();
      mocks.supabase.from.mockReturnValue(builder);
      await handler(makeReq({ method: 'POST', body: { subject: 'En', topic: 'Shakes', correct: 3, total: 4, xpEarned: 20 } }), makeRes());
      expect(builder.upsert).toHaveBeenCalledWith(expect.any(Object), { onConflict: 'user_id,subject,topic' });
    });
  });
});
