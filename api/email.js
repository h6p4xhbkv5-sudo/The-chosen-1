import { applyHeaders, isRateLimited, getIp } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  applyHeaders(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit: 10 per IP per hour (admin batch sends are routed here too)
  if (isRateLimited(`${getIp(req)}:email`, 10, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { type, email, name, stats } = req.body || {};

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
          <a href="${siteUrl}/privacy-policy.html" style="color:#6B7394">Privacy</a> ·
          <a href="${siteUrl}?unsubscribe=1" style="color:#6B7394">Unsubscribe</a>
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
        </div>
        <div style="padding:1rem 2rem;border-top:1px solid rgba(255,255,255,0.1);font-size:.8rem;color:#6B7394;text-align:center">
          <a href="${siteUrl}?unsubscribe=1" style="color:#6B7394">Unsubscribe from weekly reports</a>
        </div></div>`,
    },
    exam_reminder: {
      subject: `⏰ ${stats?.subject} exam in ${stats?.days} days — time to revise!`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;padding:2rem;border-radius:16px">
        <h2 style="color:#C9A84C">⏰ Exam reminder, ${name}</h2>
        <p>Your <strong>${stats?.subject}</strong> exam is in <strong>${stats?.days} days</strong>.</p>
        <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none;margin-top:1rem">Revise Now →</a>
        <p style="margin-top:2rem;font-size:.8rem;color:#6B7394"><a href="${siteUrl}?unsubscribe=1" style="color:#6B7394">Unsubscribe</a></p>
      </div>`,
    },
    payment_confirmed: {
      subject: '🎉 Welcome to Lumina AI — Your subscription is active!',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#8B6914);padding:2rem;text-align:center">
          <h1 style="margin:0;font-size:1.8rem">🎉 You're in!</h1>
        </div>
        <div style="padding:2rem">
          <p>Your <strong>${stats?.plan === 'homeschool' ? 'Homeschool' : 'Student'} Plan</strong> is now active.</p>
          <p>You now have full access to all Lumina AI features including unlimited AI tutoring, practice questions, essay marking, and more.</p>
          <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 2rem;border-radius:8px;font-weight:700;text-decoration:none;margin-top:1rem">Start Learning →</a>
        </div></div>`,
    },
    payment_failed: {
      subject: '⚠️ Lumina AI — Payment failed',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;padding:2rem;border-radius:16px">
        <h2 style="color:#FB7185">⚠️ Payment failed</h2>
        <p>Hi ${name || 'there'},</p>
        <p>We couldn't process your payment. Please update your payment method to continue accessing Lumina AI.</p>
        <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#0D0F18;padding:.875rem 1.5rem;border-radius:8px;font-weight:700;text-decoration:none;margin-top:1rem">Update Payment →</a>
        <p style="margin-top:1.5rem;font-size:.85rem;color:#6B7394">If you have questions, email <a href="mailto:billing@luminaai.co.uk" style="color:#C9A84C">billing@luminaai.co.uk</a></p>
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
        body: JSON.stringify({
          from: 'Lumina AI <hello@luminaai.co.uk>',
          to: email,
          subject: template.subject,
          html: template.html,
        }),
      });
      const result = await r.json();
      if (!r.ok) return res.status(500).json({ error: result?.message || 'Email send failed' });
      return res.status(200).json({ success: true, id: result.id });
    } catch (e) {
      return res.status(500).json({ error: 'Email send failed: ' + e.message });
    }
  }

  // RESEND_API_KEY not configured — tell the caller explicitly so it doesn't assume success
  return res.status(503).json({
    success: false,
    error: 'Email service not configured — add RESEND_API_KEY to Vercel environment variables',
  });
}
