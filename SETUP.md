# Lumina AI v11 — Complete Setup Guide

## New Files in This Version
- privacy-policy.html  ← Legal ✅
- terms.html           ← Legal ✅
- cookies.html         ← Legal ✅
- contact.html         ← Support + FAQ ✅
- admin.html           ← Admin dashboard ✅
- api/webhook.js       ← Stripe webhook (payments unlock accounts) ✅
- api/admin.js         ← Admin stats API ✅
- supabase-schema.sql  ← Updated with subscription_status column

## Step 1: Supabase
1. supabase.com → New Project
2. SQL Editor → run supabase-schema.sql
3. Copy Project URL and anon key

## Step 2: Vercel Environment Variables
Add ALL of these in Vercel → Settings → Environment Variables:

| Key | Where to get it |
|-----|----------------|
| ANTHROPIC_API_KEY | console.anthropic.com |
| SUPABASE_URL | Supabase → Settings → API |
| SUPABASE_SERVICE_KEY | Supabase → Settings → API → service_role |
| SUPABASE_ANON_KEY | Supabase → Settings → API → anon public |
| SITE_URL | Your Vercel URL e.g. https://lumina-ai.vercel.app |
| STRIPE_SECRET_KEY | dashboard.stripe.com → Developers → API keys |
| STRIPE_PRICE_STUDENT | Stripe → Products → Student Plan → price ID |
| STRIPE_PRICE_HOMESCHOOL | Stripe → Products → Homeschool Plan → price ID |
| STRIPE_WEBHOOK_SECRET | Stripe → Webhooks → signing secret |
| RESEND_API_KEY | resend.com → API Keys (free tier: 3000 emails/month) |
| ADMIN_SECRET_KEY | Make up a long random string — you'll use this to log into /admin.html |

## Step 3: Set Supabase config in index.html
Find this near the top of index.html:
  window.SUPABASE_URL = '';
  window.SUPABASE_ANON_KEY = '';
Paste your values between the quotes.

## Step 4: Stripe Webhook
1. Go to Stripe → Webhooks → Add endpoint
2. URL: https://your-site.vercel.app/api/webhook
3. Events to listen for:
   - checkout.session.completed
   - invoice.payment_succeeded
   - invoice.payment_failed
   - customer.subscription.deleted
4. Copy the signing secret → add as STRIPE_WEBHOOK_SECRET in Vercel

## Step 5: Email Domain (Resend)
1. Create account at resend.com
2. Add your domain (luminaai.co.uk)
3. Add DNS records as instructed
4. Copy API key → RESEND_API_KEY in Vercel

## Step 6: Update Supabase Schema
Run this additional SQL to support subscriptions:
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'free';
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_id text;

## Admin Dashboard
Visit /admin.html on your live site.
Enter the ADMIN_SECRET_KEY you set in Vercel.
You can see all users, revenue, send weekly emails.

## What's Complete in v11
✅ Privacy Policy (GDPR compliant, covers under-18s)
✅ Terms & Conditions (UK consumer law compliant)
✅ Cookie Policy + consent banner
✅ Contact + FAQ page
✅ Stripe webhook (payments unlock accounts automatically)
✅ Real email sending via Resend (welcome, weekly, exam reminders)
✅ Admin dashboard (all users, revenue, send emails)
✅ Scientific calculator
✅ Periodic table (27 elements with facts)
✅ Formula sheets (Maths, Physics, Chemistry)
✅ Voice input (speak questions to AI tutor)
✅ Bookmarks (double-click any response)
✅ Daily goals with progress ring
✅ Accessibility panel (dyslexia font, high contrast, reduce motion, auto-read)
✅ Offline mode (service worker)
✅ Print any page
✅ "Explain differently" button
✅ Footer with legal links on dashboard
✅ Activity heatmap (tracks daily XP)
✅ Goal streak tracking
