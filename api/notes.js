import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
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
    if (!text || !text.trim()) return res.status(400).json({ error: 'Note text is required' });
    if (!subject || !subject.trim()) return res.status(400).json({ error: 'Subject is required' });
    const { data } = await supabase
      .from('notes')
      .insert({ user_id: user.id, text, subject, tag, created_at: new Date().toISOString() })
      .select()
      .single();
    return res.status(200).json({ note: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'Valid note id is required' });
    await supabase.from('notes').delete().eq('id', id).eq('user_id', user.id);
    return res.status(200).json({ success: true });
  }
}
