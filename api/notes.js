import { createClient } from '@supabase/supabase-js';
import { applyHeaders, isRateLimited } from './_lib.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 50_000;
const MAX_SUBJECT_LENGTH = 100;
const MAX_TAG_LENGTH = 50;

export default async function handler(req, res) {
  applyHeaders(res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Rate limit: 60 per user per minute
  if (isRateLimited(`${user.id}:notes`, 60, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    return res.status(200).json({ notes: data || [] });
  }

  if (req.method === 'POST') {
    const { text, subject, tag } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'Note text is required' });
    if (!subject || !subject.trim()) return res.status(400).json({ error: 'Subject is required' });
    if (text.length > MAX_TEXT_LENGTH) return res.status(400).json({ error: `Note text cannot exceed ${MAX_TEXT_LENGTH} characters` });
    if (subject.length > MAX_SUBJECT_LENGTH) return res.status(400).json({ error: 'Subject too long' });
    if (tag && tag.length > MAX_TAG_LENGTH) return res.status(400).json({ error: 'Tag too long' });

    const { data } = await supabase
      .from('notes')
      .insert({
        user_id: user.id,
        text: text.trim(),
        subject: subject.trim(),
        tag: tag?.trim() || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    return res.status(200).json({ note: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Note id is required' });
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Valid note id is required' });
    await supabase.from('notes').delete().eq('id', id).eq('user_id', user.id);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
