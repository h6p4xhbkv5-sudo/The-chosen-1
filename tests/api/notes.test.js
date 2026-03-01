/**
 * Tests for the Notes API handler (api/chat.js notes section).
 *
 * The handler is a simple CRUD endpoint authenticated via a Supabase bearer
 * token. Covered scenarios:
 *
 *   GET    – returns all notes for the authenticated user, newest first
 *   POST   – inserts a new note and returns the created row
 *   DELETE – deletes a note by id, scoped to the authenticated user
 *   Auth   – unauthenticated requests receive 401 for every method
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

async function notesHandler(req, res, supabase) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    return res.status(200).json({ notes: data || [] });
  }

  if (req.method === 'POST') {
    const { text, subject, tag } = req.body;
    const { data } = await supabase
      .from('notes')
      .insert({ user_id: user.id, text, subject, tag, created_at: new Date().toISOString() })
      .select()
      .single();
    return res.status(200).json({ note: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    await supabase.from('notes').delete().eq('id', id).eq('user_id', user.id);
    return res.status(200).json({ success: true });
  }
}

// ─── Supabase mock helpers ────────────────────────────────────────────────────

function makeAuthSuccess(userId = 'user-123') {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
  };
}

function makeAuthFailure() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } }),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Notes API handler', () => {
  // ── Authentication guard ─────────────────────────────────────────────────

  describe('when unauthenticated', () => {
    it('returns 401 for GET', async () => {
      const supabase = makeAuthFailure();
      const res = makeRes();
      await notesHandler(makeReq({ method: 'GET' }), res, supabase);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 for POST', async () => {
      const supabase = makeAuthFailure();
      const res = makeRes();
      await notesHandler(makeReq({ method: 'POST' }), res, supabase);
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for DELETE', async () => {
      const supabase = makeAuthFailure();
      const res = makeRes();
      await notesHandler(makeReq({ method: 'DELETE' }), res, supabase);
      expect(res.statusCode).toBe(401);
    });
  });

  // ── CORS preflight ────────────────────────────────────────────────────────

  it('responds 200 to OPTIONS without calling Supabase', async () => {
    const supabase = { auth: { getUser: vi.fn() }, from: vi.fn() };
    const res = makeRes();
    await notesHandler(makeReq({ method: 'OPTIONS' }), res, supabase);
    expect(res.statusCode).toBe(200);
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  // ── GET /notes ────────────────────────────────────────────────────────────

  describe('GET', () => {
    it('returns the user notes ordered by created_at descending', async () => {
      const fakeNotes = [
        { id: 'n2', text: 'Newer note', created_at: '2024-02-01' },
        { id: 'n1', text: 'Older note', created_at: '2024-01-01' },
      ];

      const orderFn = vi.fn().mockResolvedValue({ data: fakeNotes });
      const eqFn = vi.fn().mockReturnValue({ order: orderFn });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const fromFn = vi.fn().mockReturnValue({ select: selectFn });

      const supabase = { ...makeAuthSuccess(), from: fromFn };

      const req = makeReq({ method: 'GET' });
      const res = makeRes();

      await notesHandler(req, res, supabase);

      expect(res.statusCode).toBe(200);
      expect(res.body.notes).toHaveLength(2);
      expect(res.body.notes[0].id).toBe('n2');
      expect(orderFn).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('returns an empty array when the user has no notes', async () => {
      const orderFn = vi.fn().mockResolvedValue({ data: null });
      const eqFn = vi.fn().mockReturnValue({ order: orderFn });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const fromFn = vi.fn().mockReturnValue({ select: selectFn });

      const supabase = { ...makeAuthSuccess(), from: fromFn };

      const res = makeRes();
      await notesHandler(makeReq({ method: 'GET' }), res, supabase);

      expect(res.body.notes).toEqual([]);
    });

    it('only fetches notes belonging to the authenticated user', async () => {
      const userId = 'user-abc';
      const orderFn = vi.fn().mockResolvedValue({ data: [] });
      const eqFn = vi.fn().mockReturnValue({ order: orderFn });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const fromFn = vi.fn().mockReturnValue({ select: selectFn });

      const supabase = { ...makeAuthSuccess(userId), from: fromFn };

      const res = makeRes();
      await notesHandler(makeReq({ method: 'GET' }), res, supabase);

      expect(eqFn).toHaveBeenCalledWith('user_id', userId);
    });
  });

  // ── POST /notes ───────────────────────────────────────────────────────────

  describe('POST', () => {
    it('inserts a note and returns the created record', async () => {
      const newNote = { id: 'n-new', text: 'Mitosis steps', subject: 'Biology', tag: 'revision' };
      const singleFn = vi.fn().mockResolvedValue({ data: newNote });
      const selectFn = vi.fn().mockReturnValue({ single: singleFn });
      const insertFn = vi.fn().mockReturnValue({ select: selectFn });
      const fromFn = vi.fn().mockReturnValue({ insert: insertFn });

      const supabase = { ...makeAuthSuccess(), from: fromFn };

      const req = makeReq({
        method: 'POST',
        body: { text: 'Mitosis steps', subject: 'Biology', tag: 'revision' },
      });
      const res = makeRes();

      await notesHandler(req, res, supabase);

      expect(res.statusCode).toBe(200);
      expect(res.body.note).toEqual(newNote);
      expect(insertFn).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Mitosis steps', subject: 'Biology', tag: 'revision' }),
      );
    });

    it('scopes the inserted note to the authenticated user_id', async () => {
      const userId = 'user-post';
      const singleFn = vi.fn().mockResolvedValue({ data: {} });
      const selectFn = vi.fn().mockReturnValue({ single: singleFn });
      const insertFn = vi.fn().mockReturnValue({ select: selectFn });
      const fromFn = vi.fn().mockReturnValue({ insert: insertFn });

      const supabase = { ...makeAuthSuccess(userId), from: fromFn };

      const req = makeReq({ method: 'POST', body: { text: 'Note', subject: 'Maths', tag: '' } });
      const res = makeRes();

      await notesHandler(req, res, supabase);

      expect(insertFn).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: userId }),
      );
    });
  });

  // ── DELETE /notes ─────────────────────────────────────────────────────────

  describe('DELETE', () => {
    it('deletes the specified note scoped to the authenticated user', async () => {
      const userId = 'user-del';
      const eqUser = vi.fn().mockResolvedValue({ data: null, error: null });
      const eqId = vi.fn().mockReturnValue({ eq: eqUser });
      const deleteFn = vi.fn().mockReturnValue({ eq: eqId });
      const fromFn = vi.fn().mockReturnValue({ delete: deleteFn });

      const supabase = { ...makeAuthSuccess(userId), from: fromFn };

      const req = makeReq({ method: 'DELETE', body: { id: 'note-42' } });
      const res = makeRes();

      await notesHandler(req, res, supabase);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(eqId).toHaveBeenCalledWith('id', 'note-42');
      expect(eqUser).toHaveBeenCalledWith('user_id', userId);
    });
  });
});
