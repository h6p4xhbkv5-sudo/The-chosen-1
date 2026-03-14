import { createClient } from '@supabase/supabase-js';

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabase) {
    // Demo mode: notes stored client-side only
    if (req.method === 'GET') return res.status(200).json({ notes: [] });
    return res.status(200).json({ success: true, note: req.body || {} });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data } = await supabase.from('notes').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    return res.status(200).json({ notes: data || [] });
  }

  if (req.method === 'POST') {
    const { text, subject, tag } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (!subject) return res.status(400).json({ error: 'subject is required' });
    const { data } = await supabase.from('notes').insert({
      user_id: user.id,
      text,
      subject,
      tag,
      created_at: new Date().toISOString()
    }).select().single();
    return res.status(200).json({ note: data });
  }

  if (req.method === 'PUT') {
    const { id, text, subject, tag } = req.body;
    const updates = {};
    if (text !== undefined) updates.text = text;
    if (subject !== undefined) updates.subject = subject;
    if (tag !== undefined) updates.tag = tag;
    const { data, error: updateErr } = await supabase.from('notes')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (updateErr) return res.status(400).json({ error: updateErr.message });
    if (!data) return res.status(404).json({ error: 'Note not found' });
    return res.status(200).json({ note: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'A valid id is required' });
    await supabase.from('notes').delete().eq('id', id).eq('user_id', user.id);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
