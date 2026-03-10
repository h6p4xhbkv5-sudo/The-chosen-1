/**
 * Tests for api/auth.js — imports and exercises the real handler.
 *
 * @supabase/supabase-js is mocked via vi.hoisted() so the module-level
 * `const supabase = createClient(...)` in auth.js receives our mock object.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Shared mock objects (hoisted above vi.mock) ──────────────────────────────
const mocks = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  const supabase = {
    auth: {
      admin: {
        createUser: vi.fn(),
        inviteUserByEmail: vi.fn(),
      },
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      getUser: vi.fn(),
    },
    from: vi.fn(),
  };
  return { supabase };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mocks.supabase,
}));

import handler from '../../api/auth.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Thenable chain builder — every chained method returns itself so the whole
 * chain can be awaited. Configure the resolved value via `resolution`.
 */
function makeBuilder(resolution = { data: null, error: null }) {
  const b = {
    _resolvedWith: resolution,
    then(res, rej) { return Promise.resolve(b._resolvedWith).then(res, rej); },
  };
  ['select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'gte', 'in', 'order', 'limit', 'single'].forEach(m => {
    b[m] = vi.fn().mockReturnValue(b);
  });
  return b;
}

function makeReq(overrides = {}) {
  return { method: 'POST', headers: {}, body: {}, ...overrides };
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

describe('Auth handler (api/auth.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SITE_URL = 'https://lumina.example.com';
    mocks.supabase.auth.admin.inviteUserByEmail.mockResolvedValue({});
    mocks.supabase.auth.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'tok-123' } }, error: null });
    mocks.supabase.from.mockReturnValue(makeBuilder());
  });

  afterEach(() => {
    delete process.env.SITE_URL;
  });

  // ── OPTIONS preflight ─────────────────────────────────────────────────────

  it('responds 200 to OPTIONS without hitting Supabase', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'OPTIONS' }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.supabase.auth.admin.createUser).not.toHaveBeenCalled();
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe('input validation', () => {
    it('returns 400 for a malformed email on signup', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'signup', email: 'not-an-email', password: 'password123', name: 'Alice' } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 when password is shorter than 8 characters', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'signup', email: 'a@b.com', password: 'short', name: 'Alice' } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/password/i);
    });

    it('returns 400 when name is empty', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'signup', email: 'a@b.com', password: 'password123', name: '' } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it('returns 400 for an unrecognised plan value', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'signup', email: 'a@b.com', password: 'password123', name: 'Alice', plan: 'enterprise' } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/plan/i);
    });

    it('returns 400 for a malformed email on login', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'login', email: 'bad', password: 'password123' } }), res);
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for a malformed email on reset', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'reset', email: 'bad' } }), res);
      expect(res.statusCode).toBe(400);
    });
  });

  // ── signup ────────────────────────────────────────────────────────────────

  describe('signup', () => {
    const VALID = { action: 'signup', email: 'alice@example.com', password: 'password123', name: 'Alice' };

    it('creates a user and returns success with token', async () => {
      mocks.supabase.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
      const res = makeRes();
      await handler(makeReq({ body: VALID }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe('u-1');
      expect(res.body.token).toBe('tok-123');
    });

    it('calls createUser with correct email_confirm and metadata', async () => {
      mocks.supabase.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u-2' } }, error: null });
      await handler(makeReq({ body: VALID }), makeRes());
      expect(mocks.supabase.auth.admin.createUser).toHaveBeenCalledWith({
        email: 'alice@example.com',
        password: 'password123',
        email_confirm: false,
        user_metadata: { name: 'Alice', plan: 'student' },
      });
    });

    it('defaults plan to "student" when not provided', async () => {
      mocks.supabase.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u-3' } }, error: null });
      await handler(makeReq({ body: VALID }), makeRes());
      expect(mocks.supabase.auth.admin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ user_metadata: expect.objectContaining({ plan: 'student' }) }),
      );
    });

    it('uses the homeschool plan when explicitly specified', async () => {
      mocks.supabase.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u-4' } }, error: null });
      await handler(makeReq({ body: { ...VALID, plan: 'homeschool' } }), makeRes());
      expect(mocks.supabase.auth.admin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ user_metadata: expect.objectContaining({ plan: 'homeschool' }) }),
      );
    });

    it('writes a profile row to Supabase', async () => {
      mocks.supabase.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u-5' } }, error: null });
      await handler(makeReq({ body: VALID }), makeRes());
      expect(mocks.supabase.from).toHaveBeenCalledWith('profiles');
    });

    it('sends an invite email', async () => {
      mocks.supabase.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u-6' } }, error: null });
      await handler(makeReq({ body: VALID }), makeRes());
      expect(mocks.supabase.auth.admin.inviteUserByEmail).toHaveBeenCalledWith('alice@example.com');
    });

    it('returns 400 on a duplicate email error from Supabase', async () => {
      mocks.supabase.auth.admin.createUser.mockResolvedValue({ data: null, error: { message: 'Email already registered' } });
      const res = makeRes();
      await handler(makeReq({ body: VALID }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Email already registered');
    });

    it('returns 500 when createUser throws unexpectedly', async () => {
      mocks.supabase.auth.admin.createUser.mockRejectedValue(new Error('DB is down'));
      const res = makeRes();
      await handler(makeReq({ body: VALID }), res);
      expect(res.statusCode).toBe(500);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns a token and merged user+profile on success', async () => {
      mocks.supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: { id: 'u-log', email: 'a@a.com' }, session: { access_token: 'tok_abc' } }, error: null,
      });
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: { xp: 400, level: 3 }, error: null }));

      const res = makeRes();
      await handler(makeReq({ body: { action: 'login', email: 'a@a.com', password: 'password123' } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBe('tok_abc');
      expect(res.body.user).toMatchObject({ id: 'u-log', xp: 400 });
    });

    it('returns 401 for invalid credentials', async () => {
      mocks.supabase.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: 'Invalid login' } });
      const res = makeRes();
      await handler(makeReq({ body: { action: 'login', email: 'x@x.com', password: 'wrongpass1' } }), res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('sends a reset email and returns success', async () => {
      mocks.supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      const res = makeRes();
      await handler(makeReq({ body: { action: 'reset', email: 'alice@example.com' } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mocks.supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'alice@example.com',
        { redirectTo: 'https://lumina.example.com/reset-password' },
      );
    });

    it('returns 400 when Supabase returns an error', async () => {
      mocks.supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'User not found' } });
      const res = makeRes();
      await handler(makeReq({ body: { action: 'reset', email: 'nobody@example.com' } }), res);
      expect(res.statusCode).toBe(400);
    });
  });

  // ── verify ────────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('resolves a valid token to the merged user+profile', async () => {
      mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u-ver' } }, error: null });
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: { xp: 50 }, error: null }));

      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer valid-tok' }, body: { action: 'verify' } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.user).toMatchObject({ id: 'u-ver', xp: 50 });
      expect(mocks.supabase.auth.getUser).toHaveBeenCalledWith('valid-tok');
    });

    it('returns 401 when no Authorization header is present', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'verify' } }), res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('No token');
    });

    it('returns 401 for an invalid token', async () => {
      mocks.supabase.auth.getUser.mockResolvedValue({ data: null, error: { message: 'bad JWT' } });
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer bad' }, body: { action: 'verify' } }), res);
      expect(res.statusCode).toBe(401);
    });
  });

  // ── unknown action ────────────────────────────────────────────────────────

  it('returns 400 for an unknown action', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { action: 'hack' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Unknown action');
  });
});
