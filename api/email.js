const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, email, name, stats } = req.body;

  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const siteUrl = process.env.SITE_URL || 'https://lumina-ai.vercel.app';

  const templates = {
    welcome: {
      subject: `Welcome to Lumina AI, ${name}! 🎓`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#8B6914);padding:2rem;text-align:center">
          <h1 style="font-size:2rem;margin:0">Lumina AI</h1>
          <p style="opacity:.8;margin:.5rem 0 0">AI-Powered Learning for UK Students</p>
        </div>
        <div style="padding:2rem">
          <h2 style="color:#C9A84C">Welcome, ${name}! 👋</h2>
          <p>You're all set on Lumina AI. Here's what to try first:</p>
          <ul style="line-height:2.2">
            <li>🤖 <strong>Ask your AI Tutor</strong> — type any question</li>
            <li>📝 <strong>Generate practice questions</strong> for your exam subjects</li>
            <li>✍️ <strong>Get essays marked</strong> with a predicted grade</li>
          </ul>
          <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none;margin-top:1rem">Start Learning →</a>
        </div>
        <div style="padding:1rem 2rem;border-top:1px solid rgba(255,255,255,0.1);font-size:.8rem;color:#6B7394;text-align:center">
          Lumina AI · <a href="mailto:support@luminaai.co.uk" style="color:#6B7394">support@luminaai.co.uk</a> ·
          <a href="${siteUrl}/privacy-policy.html" style="color:#6B7394">Privacy</a>
        </div></div>`,
    },
    weekly: {
      subject: `Your weekly Lumina progress report 📊`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#8B6914);padding:2rem;text-align:center">
          <h1 style="font-size:1.5rem;margin:0">📊 Weekly Report</h1>
        </div>
        <div style="padding:2rem">
          <h2 style="color:#C9A84C">Hi ${name}!</h2>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1.5rem 0">
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#C9A84C">${stats?.questions || 0}</div><div>Questions answered</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#4ADE80">${stats?.accuracy || 0}%</div><div>Accuracy</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#60A5FA">${stats?.xp || 0}</div><div>XP earned</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#FB923C">${stats?.streak || 0}🔥</div><div>Day streak</div></div>
          </div>
          <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none">Keep Going →</a>
        </div></div>`,
    },
    exam_reminder: {
      subject: `⏰ ${stats?.subject} exam in ${stats?.days} days — time to revise!`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;padding:2rem">
        <h2 style="color:#C9A84C">⏰ Exam reminder, ${name}</h2>
        <p>Your <strong>${stats?.subject}</strong> exam is in <strong>${stats?.days} days</strong>.</p>
        <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none;margin-top:1rem">Revise Now →</a>
      </div>`,
    },
  };

  const template = templates[type];
  if (!template) return res.status(400).json({ error: 'Unknown email type' });

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Lumina AI <hello@luminaai.co.uk>', to: email, subject: template.subject, html: template.html }),
      });
      const result = await r.json();
      return res.status(200).json({ success: true, id: result.id });
    } catch (e) {
      return res.status(500).json({ error: 'Email send failed: ' + e.message });
    }
  }

  return res.status(200).json({ success: true, note: 'Add RESEND_API_KEY to Vercel to send real emails', preview: template.html });
}
