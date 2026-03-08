/**
 * Tests for api/notes.js — imports and exercises the real handler.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const supabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };
  return { supabase };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mocks.supabase,
}));

import handler from '../../api/notes.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBuilder(resolution = { data: null, error: null }) {
  const b = {
    _resolvedWith: resolution,
    then(res, rej) { return Promise.resolve(b._resolvedWith).then(res, rej); },
  };
  ['select', 'insert', 'update', 'delete',
    'eq', 'order', 'limit', 'single'].forEach(m => {
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

describe('Notes handler (api/notes.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-abc' } }, error: null });
    mocks.supabase.from.mockReturnValue(makeBuilder());
  });

  // ── OPTIONS ───────────────────────────────────────────────────────────────

  it('responds 200 to OPTIONS without calling Supabase', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'OPTIONS', headers: {} }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.supabase.auth.getUser).not.toHaveBeenCalled();
  });

  // ── Auth guard ────────────────────────────────────────────────────────────

  describe('authentication', () => {
    beforeEach(() => {
      mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad token' } });
    });

    it.each(['GET', 'POST', 'DELETE'])('returns 401 for unauthenticated %s', async (method) => {
      const res = makeRes();
      await handler(makeReq({ method, headers: {} }), res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });

  // ── GET ───────────────────────────────────────────────────────────────────

  describe('GET', () => {
    it('returns the notes list', async () => {
      const fakeNotes = [{ id: 'n1', text: 'Hello' }, { id: 'n2', text: 'World' }];
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: fakeNotes, error: null }));
      const res = makeRes();
      await handler(makeReq({ method: 'GET' }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.notes).toEqual(fakeNotes);
    });

    it('returns an empty array when the user has no notes', async () => {
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: null, error: null }));
      const res = makeRes();
      await handler(makeReq({ method: 'GET' }), res);
      expect(res.body.notes).toEqual([]);
    });

    it('scopes the query to the authenticated user_id', async () => {
      mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'specific-user' } }, error: null });
      const builder = makeBuilder({ data: [], error: null });
      mocks.supabase.from.mockReturnValue(builder);
      await handler(makeReq({ method: 'GET' }), makeRes());
      expect(mocks.supabase.from).toHaveBeenCalledWith('notes');
      expect(builder.eq).toHaveBeenCalledWith('user_id', 'specific-user');
    });

    it('orders results by created_at descending', async () => {
      const builder = makeBuilder({ data: [], error: null });
      mocks.supabase.from.mockReturnValue(builder);
      await handler(makeReq({ method: 'GET' }), makeRes());
      expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });
  });

  // ── POST ──────────────────────────────────────────────────────────────────

  describe('POST', () => {
    it('inserts a note and returns it', async () => {
      const newNote = { id: 'new-1', text: 'Test note', subject: 'Maths' };
      mocks.supabase.from.mockReturnValue(makeBuilder({ data: newNote, error: null }));
      const res = makeRes();
      await handler(makeReq({ method: 'POST', body: { text: 'Test note', subject: 'Maths', tag: 'revision' } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.note).toEqual(newNote);
    });

    it('scopes the insert to the authenticated user_id', async () => {
      const builder = makeBuilder({ data: {}, error: null });
      mocks.supabase.from.mockReturnValue(builder);
      await handler(makeReq({ method: 'POST', body: { text: 'My note', subject: 'Chemistry', tag: '' } }), makeRes());
      expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-abc' }));
    });

    it('returns 400 when text is empty', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'POST', body: { text: '', subject: 'Maths' } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/text/i);
    });

    it('returns 400 when subject is empty', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'POST', body: { text: 'Some note', subject: '' } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/subject/i);
    });
  });

  // ── DELETE ────────────────────────────────────────────────────────────────

  describe('DELETE', () => {
    const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

    it('deletes the note scoped to the authenticated user', async () => {
      const builder = makeBuilder({ data: null, error: null });
      mocks.supabase.from.mockReturnValue(builder);
      const res = makeRes();
      await handler(makeReq({ method: 'DELETE', body: { id: VALID_UUID } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(builder.eq).toHaveBeenCalledWith('id', VALID_UUID);
      expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-abc');
    });

    it('returns 400 when id is missing', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'DELETE', body: {} }), res);
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for a non-UUID id', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'DELETE', body: { id: 'not-a-uuid' } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/id/i);
    });
  });
});
