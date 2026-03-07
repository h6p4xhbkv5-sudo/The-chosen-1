export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured. Add it to your Vercel environment variables.' });

  // Validate request body
  const { model, messages, max_tokens, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request: messages array required' });
  }

  try {
    const body = { model: model || 'claude-sonnet-4-6', messages, max_tokens: max_tokens || 1500 };
    if (system) body.system = system;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to connect to AI service. Please try again.' });
  }
}
