import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
    return res.status(200).json({ note: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    await supabase.from('notes').delete().eq('id', id).eq('user_id', user.id);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
