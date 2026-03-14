/**
 * POST /api/contact
 * Accepts a contact form submission and emails it to support via Resend.
 * Rate-limited to 5 requests per hour per IP.
 */

import { applyHeaders, isRateLimited, getIp } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES = [
  'General support',
  'Billing issue',
  'School / bulk licensing',
  'Privacy / data request',
  'Bug report',
  'Feature request',
  'Other',
];

export default async function handler(req, res) {
  applyHeaders(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit: 5 submissions per IP per hour
  if (isRateLimited(`${getIp(req)}:contact`, 5, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many requests — please try again later' });
  }

  const { name, email, category, message } = req.body || {};

  // Validation
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!message || message.trim().length < 10) return res.status(400).json({ error: 'Message must be at least 10 characters' });
  if (message.length > 5000) return res.status(400).json({ error: 'Message must be under 5000 characters' });
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });

  const safeCategory = category || 'General support';

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    // Dev mode — log and acknowledge without sending
    console.log('[contact] RESEND_API_KEY not set. Would have sent:', { name, email, safeCategory, message });
    return res.status(200).json({ success: true, note: 'RESEND_API_KEY not configured — email not sent' });
  }

  try {
    const html = `
      <h2>New Contact Form Submission</h2>
      <table>
        <tr><td><strong>Name:</strong></td><td>${htmlEscape(name)}</td></tr>
        <tr><td><strong>Email:</strong></td><td>${htmlEscape(email)}</td></tr>
        <tr><td><strong>Category:</strong></td><td>${htmlEscape(safeCategory)}</td></tr>
      </table>
      <h3>Message</h3>
      <p style="white-space:pre-wrap">${htmlEscape(message)}</p>
      <hr>
      <p style="color:#888;font-size:12px">Sent from Synaptiq contact form</p>
    `;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Synaptiq <hello@luminaai.co.uk>',
        to: 'support@luminaai.co.uk',
        reply_to: email,
        subject: `[${safeCategory}] Message from ${name}`,
        html,
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data?.message || 'Failed to send email' });
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function htmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
