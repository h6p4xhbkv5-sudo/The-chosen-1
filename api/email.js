export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, email, name, stats } = req.body;
  const siteUrl = process.env.SITE_URL || 'https://synaptiq.vercel.app';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!name) return res.status(400).json({ error: 'name is required' });

  const templates = {
    welcome: {
      subject: `Welcome to Synaptiq, ${name}!`,
      html: `<div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#A07830);padding:2rem;text-align:center">
          <h1 style="font-family:'Syne',sans-serif;font-size:2rem;margin:0;color:#08090E">Synaptiq</h1>
          <p style="opacity:.8;margin:.5rem 0 0;color:#08090E">AI-Powered Learning for UK Students</p>
        </div>
        <div style="padding:2rem">
          <h2 style="color:#C9A84C">Welcome, ${name}!</h2>
          <p>You're all set on Synaptiq. Here's what to try first:</p>
          <ul style="line-height:2.2">
            <li><strong>Ask your AI Tutor</strong> — type any question</li>
            <li><strong>Generate practice questions</strong> for your exam subjects</li>
            <li><strong>Get essays marked</strong> with a predicted grade</li>
            <li><strong>Photo a question</strong> from your textbook</li>
            <li><strong>Watch a video explanation</strong> on anything you're stuck on</li>
          </ul>
          <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#08090E;padding:.875rem 2rem;border-radius:10px;font-weight:700;text-decoration:none;margin-top:1rem">Start Learning</a>
        </div>
        <div style="padding:1rem 2rem;border-top:1px solid rgba(255,255,255,0.07);font-size:.8rem;color:#6B7394;text-align:center">
          Synaptiq &middot; <a href="${siteUrl}/privacy" style="color:#6B7394">Privacy</a> &middot; <a href="${siteUrl}/terms" style="color:#6B7394">Terms</a>
        </div>
      </div>`
    },
    payment_confirmed: {
      subject: 'Your Synaptiq subscription is active!',
      html: `<div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#A07830);padding:2rem;text-align:center">
          <h1 style="font-family:'Syne',sans-serif;font-size:1.8rem;margin:0;color:#08090E">You're in!</h1>
        </div>
        <div style="padding:2rem">
          <p>Your <strong>${stats?.plan === 'homeschool' ? 'Homeschool' : 'Student'} Plan</strong> is now active.</p>
          <p>You now have full access to all Synaptiq features.</p>
          <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#08090E;padding:.875rem 2rem;border-radius:10px;font-weight:700;text-decoration:none;margin-top:1rem">Start Learning</a>
        </div>
      </div>`
    },
    payment_failed: {
      subject: 'Synaptiq — Payment failed',
      html: `<div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden;padding:2rem">
        <h2 style="color:#C9A84C">Payment issue</h2>
        <p>Hi ${name},</p>
        <p>We couldn't process your latest payment. Please update your payment method to continue accessing Synaptiq.</p>
        <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#08090E;padding:.875rem 2rem;border-radius:10px;font-weight:700;text-decoration:none;margin-top:1rem">Update Payment</a>
      </div>`
    },
    weekly: {
      subject: 'Your weekly Synaptiq progress report',
      html: `<div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#C9A84C,#A07830);padding:2rem;text-align:center">
          <h1 style="font-family:'Syne',sans-serif;font-size:1.5rem;margin:0;color:#08090E">Weekly Report</h1>
          <p style="opacity:.8;color:#08090E">Week ending ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div style="padding:2rem">
          <h2 style="color:#C9A84C">Hi ${name}!</h2>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1.5rem 0">
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#C9A84C">${stats?.questions || 0}</div><div style="font-size:.8rem;color:#6B7394">Questions answered</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#4ADE80">${stats?.accuracy || 0}%</div><div style="font-size:.8rem;color:#6B7394">Accuracy</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#60A5FA">${stats?.xp || 0}</div><div style="font-size:.8rem;color:#6B7394">XP earned</div></div>
            <div style="background:#181C2A;border-radius:10px;padding:1rem;text-align:center"><div style="font-size:2rem;font-weight:800;color:#FB923C">${stats?.streak || 0}</div><div style="font-size:.8rem;color:#6B7394">Day streak</div></div>
          </div>
          <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#08090E;padding:.875rem 2rem;border-radius:10px;font-weight:700;text-decoration:none">Keep Going</a>
        </div>
      </div>`
    },
    exam_reminder: {
      subject: `${stats?.subject} exam in ${stats?.days} days — time to revise!`,
      html: `<div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;background:#0D0F18;color:#F0EEF8;border-radius:16px;overflow:hidden;padding:2rem">
        <h2 style="color:#C9A84C">Exam reminder, ${name}</h2>
        <p>Your <strong>${stats?.subject}</strong> exam is in <strong>${stats?.days} days</strong>.</p>
        <p>Log in to Synaptiq and use the revision timetable, practice questions, and video explainers to make the most of your remaining time.</p>
        <a href="${siteUrl}" style="display:inline-block;background:#C9A84C;color:#08090E;padding:.875rem 2rem;border-radius:10px;font-weight:700;text-decoration:none;margin-top:1rem">Revise Now</a>
      </div>`
    }
  };

  const template = templates[type];
  if (!template) return res.status(400).json({ error: 'Unknown email type' });

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Synaptiq <hello@synaptiq.co.uk>',
          to: email,
          subject: template.subject,
          html: template.html
        })
      });
      const result = await r.json();
      return res.status(200).json({ success: true, id: result.id });
    } catch (e) {
      return res.status(500).json({ error: 'Email send failed: ' + e.message });
    }
  }

  return res.status(200).json({ success: true, note: 'Add RESEND_API_KEY to send real emails', preview: template.html });
}
