# Lumina AI

AI-powered educational platform for UK GCSE and A-Level students.

## Tech Stack

- **Frontend**: Single-file HTML/CSS/JavaScript (`index.html`)
- **Backend**: Vercel Serverless Functions (`/api/`)
- **Database & Auth**: Supabase (PostgreSQL + built-in auth)
- **Payments**: Stripe (subscriptions, webhooks)
- **Email**: Resend API
- **AI**: Anthropic Claude API (`claude-sonnet-4-20250514`)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/lumina-ai.git
cd lumina-ai
npm install
```

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase-schema.sql` in the SQL Editor
3. Copy your project URL and keys

### 3. Stripe

1. Create products and prices for Student (£60/month) and Homeschool (£200/month)
2. Set up a webhook endpoint pointing to `https://your-domain.vercel.app/api/webhook`
3. Listen for: `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`

### 4. Environment Variables

Set these in [Vercel Dashboard](https://vercel.com) → Settings → Environment Variables:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `SITE_URL` | Your deployed URL (e.g. `https://lumina-ai.vercel.app`) |
| `RESEND_API_KEY` | Resend API key for emails |
| `ADMIN_SECRET_KEY` | Password for admin dashboard |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_PRICE_STUDENT` | Stripe price ID for Student plan |
| `STRIPE_PRICE_HOMESCHOOL` | Stripe price ID for Homeschool plan |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

### 5. Deploy

```bash
vercel --prod
```

## File Structure

```
/
├── index.html              ← Entire frontend app (single file)
├── admin.html              ← Admin dashboard (password protected)
├── privacy-policy.html     ← GDPR privacy policy
├── terms.html              ← Terms & Conditions
├── cookies.html            ← Cookie policy
├── contact.html            ← Contact + FAQ page
├── vercel.json             ← Vercel routing config
├── package.json            ← Node dependencies
├── .gitignore              ← Excludes node_modules, .env
├── supabase-schema.sql     ← Full database schema
└── api/
    ├── config.js           ← Serves Supabase public keys to browser
    ├── chat.js             ← Anthropic API proxy
    ├── auth.js             ← Signup, login, password reset
    ├── progress.js         ← Save/load student progress
    ├── notes.js            ← CRUD for student notes
    ├── email.js            ← Send emails via Resend
    ├── stripe.js           ← Checkout + billing portal
    ├── webhook.js          ← Stripe webhook (unlocks accounts)
    └── admin.js            ← Admin stats API
```

## Local Development

The platform works with localStorage fallback when Supabase is not configured. Simply open `index.html` in a browser or use:

```bash
npx vercel dev
```

## Licence

© 2026 Lumina AI Ltd. All rights reserved.
