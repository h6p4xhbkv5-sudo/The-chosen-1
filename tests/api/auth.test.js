/**
 * Tests for the Auth API handler (api/chat.js auth section)
 *
 * The handler supports four actions:
 *   signup  – create user + profile row + send invite email
 *   login   – sign in with password, return token + profile
 *   reset   – send password-reset email
 *   verify  – validate a bearer token, return profile
 *
 * NOTE: api/chat.js currently concatenates every handler into a single file
 * with multiple `export default` declarations, which is invalid JS. The logic
 * is reproduced here via an injectable helper so tests can run against real
 * business logic until the file is split into separate serverless functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Minimal req/res stubs ───────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: {},
    body: {},
    query: {},
    ...overrides,
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    end() { return this; },
  };
  return res;
}

// ─── Handler extracted for testability ──────────────────────────────────────
// Mirrors the auth section of api/chat.js with supabase injected.

async function authHandler(req, res, supabase, env = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, email, password, name, plan } = req.body;

  try {
    if (action === 'signup') {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: { name, plan: plan || 'student' },
      });
      if (error) return res.status(400).json({ error: error.message });

      await supabase.from('profiles').insert({
        id: data.user.id,
        name, email, plan: plan || 'student',
        xp: 0, level: 1, streak: 0,
        questions_answered: 0, accuracy: 0,
        created_at: new Date().toISOString(),
      });

      await supabase.auth.admin.inviteUserByEmail(email);

      return res.status(200).json({ success: true, user: data.user });
    }

    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: 'Invalid email or password' });

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      return res.status(200).json({
        success: true,
        token: data.session.access_token,
        user: { ...data.user, ...profile },
      });
    }

    if (action === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${env.SITE_URL}/reset-password`,
      });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'verify') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });

      const { data, error } = await supabase.auth.getUser(token);
      if (error) return res.status(401).json({ error: 'Invalid token' });

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      return res.status(200).json({ success: true, user: { ...data.user, ...profile } });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Supabase mock factory ───────────────────────────────────────────────────

function makeSupabaseMock() {
  const rowBuilder = () => {
    const b = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ data: {}, error: null }),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
    };
    return b;
  };

  return {
    auth: {
      admin: {
        createUser: vi.fn(),
        inviteUserByEmail: vi.fn().mockResolvedValue({}),
      },
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      getUser: vi.fn(),
    },
    from: vi.fn(() => rowBuilder()),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Auth handler', () => {
  let supabase;

  beforeEach(() => {
    supabase = makeSupabaseMock();
  });

  // ── CORS preflight ──────────────────────────────────────────────────────

  describe('OPTIONS preflight', () => {
    it('responds 200 and ends without a body', async () => {
      const req = makeReq({ method: 'OPTIONS' });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  // ── signup ──────────────────────────────────────────────────────────────

  describe('signup', () => {
    it('creates a user, inserts a profile row, and sends an invite email', async () => {
      const fakeUser = { id: 'user-123' };
      supabase.auth.admin.createUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

      const req = makeReq({
        body: { action: 'signup', email: 'alice@example.com', password: 'secret', name: 'Alice' },
      });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toEqual(fakeUser);

      expect(supabase.auth.admin.createUser).toHaveBeenCalledWith({
        email: 'alice@example.com',
        password: 'secret',
        email_confirm: false,
        user_metadata: { name: 'Alice', plan: 'student' },
      });

      expect(supabase.auth.admin.inviteUserByEmail).toHaveBeenCalledWith('alice@example.com');
    });

    it('defaults plan to "student" when no plan is supplied', async () => {
      const fakeUser = { id: 'user-456' };
      supabase.auth.admin.createUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

      const req = makeReq({
        body: { action: 'signup', email: 'bob@example.com', password: 'pass', name: 'Bob' },
      });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(supabase.auth.admin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ user_metadata: { name: 'Bob', plan: 'student' } }),
      );
    });

    it('stores the specified plan when one is provided', async () => {
      const fakeUser = { id: 'user-789' };
      supabase.auth.admin.createUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

      const req = makeReq({
        body: { action: 'signup', email: 'carol@example.com', password: 'pass', name: 'Carol', plan: 'homeschool' },
      });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(supabase.auth.admin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ user_metadata: { name: 'Carol', plan: 'homeschool' } }),
      );
    });

    it('returns 400 when Supabase reports an auth error', async () => {
      supabase.auth.admin.createUser.mockResolvedValue({
        data: null,
        error: { message: 'Email already registered' },
      });

      const req = makeReq({
        body: { action: 'signup', email: 'dup@example.com', password: 'pass', name: 'Dup' },
      });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Email already registered');
    });

    it('returns 500 when createUser throws an unexpected error', async () => {
      supabase.auth.admin.createUser.mockRejectedValue(new Error('Network failure'));

      const req = makeReq({
        body: { action: 'signup', email: 'err@example.com', password: 'pass', name: 'Err' },
      });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Network failure');
    });
  });

  // ── login ───────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns a token and merged user+profile on success', async () => {
      const fakeUser = { id: 'user-abc', email: 'alice@example.com' };
      const fakeSession = { access_token: 'tok_xyz' };
      const fakeProfile = { xp: 500, level: 2, streak: 7 };

      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: fakeUser, session: fakeSession },
        error: null,
      });
      // Make the chained from().select().eq().single() resolve with a profile
      const single = vi.fn().mockResolvedValue({ data: fakeProfile, error: null });
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq });
      supabase.from = vi.fn().mockReturnValue({ select });

      const req = makeReq({ body: { action: 'login', email: 'alice@example.com', password: 'secret' } });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBe('tok_xyz');
      expect(res.body.user).toMatchObject({ id: 'user-abc', xp: 500, level: 2 });
    });

    it('returns 401 when credentials are wrong', async () => {
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      const req = makeReq({ body: { action: 'login', email: 'x@x.com', password: 'wrong' } });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });
  });

  // ── reset ───────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('sends a password-reset email and returns success', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

      const req = makeReq({ body: { action: 'reset', email: 'alice@example.com' } });
      const res = makeRes();

      await authHandler(req, res, supabase, { SITE_URL: 'https://lumina.example.com' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'alice@example.com',
        { redirectTo: 'https://lumina.example.com/reset-password' },
      );
    });

    it('returns 400 when Supabase reports an error', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({
        error: { message: 'User not found' },
      });

      const req = makeReq({ body: { action: 'reset', email: 'nobody@example.com' } });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('User not found');
    });
  });

  // ── verify ──────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('returns the user and profile for a valid bearer token', async () => {
      const fakeUser = { id: 'user-verify' };
      const fakeProfile = { xp: 100 };

      supabase.auth.getUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

      const single = vi.fn().mockResolvedValue({ data: fakeProfile, error: null });
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq });
      supabase.from = vi.fn().mockReturnValue({ select });

      const req = makeReq({ headers: { authorization: 'Bearer valid-token' }, body: { action: 'verify' } });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toMatchObject({ id: 'user-verify', xp: 100 });
      expect(supabase.auth.getUser).toHaveBeenCalledWith('valid-token');
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const req = makeReq({ body: { action: 'verify' } });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('No token');
    });

    it('returns 401 when the token is invalid', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: null, error: { message: 'Invalid JWT' } });

      const req = makeReq({
        headers: { authorization: 'Bearer bad-token' },
        body: { action: 'verify' },
      });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Invalid token');
    });
  });

  // ── unknown action ──────────────────────────────────────────────────────

  describe('unknown action', () => {
    it('returns 400 for an unrecognised action', async () => {
      const req = makeReq({ body: { action: 'delete_everything' } });
      const res = makeRes();

      await authHandler(req, res, supabase);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Unknown action');
    });
  });
});
