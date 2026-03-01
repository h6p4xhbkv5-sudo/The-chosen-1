-- ══════════════════════════════════════════════════════════════
-- LUMINA AI — SUPABASE DATABASE SCHEMA
-- Run this in Supabase SQL Editor → New Query → Run
-- Safe to re-run (uses CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ══════════════════════════════════════════════════════════════

-- ─── PROFILES (one per user) ──────────────────────────────────
create table if not exists profiles (
  id                  uuid references auth.users on delete cascade primary key,
  name                text not null,
  email               text not null,
  plan                text default 'student',
  subscription_status text default 'free',
  stripe_customer_id  text,
  subscription_id     text,
  xp                  integer default 0,
  level               integer default 1,
  streak              integer default 0,
  longest_streak      integer default 0,
  questions_answered  integer default 0,
  accuracy            integer default 0,
  last_active         date,
  created_at          timestamptz default now()
);

-- Idempotent column additions for existing deployments
alter table profiles add column if not exists subscription_status text default 'free';
alter table profiles add column if not exists stripe_customer_id  text;
alter table profiles add column if not exists subscription_id     text;

-- ─── PROGRESS (per subject/topic) ────────────────────────────
create table if not exists progress (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references profiles(id) on delete cascade,
  subject        text not null,
  topic          text not null,
  accuracy       integer default 0,
  questions_done integer default 0,
  last_practiced timestamptz default now(),
  unique(user_id, subject, topic)
);

-- ─── NOTES ───────────────────────────────────────────────────
create table if not exists notes (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references profiles(id) on delete cascade,
  text       text not null,
  subject    text,
  tag        text,
  created_at timestamptz default now()
);

-- ─── CHAT HISTORY ─────────────────────────────────────────────
create table if not exists chat_history (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references profiles(id) on delete cascade,
  subject    text,
  question   text,
  answer     text,
  created_at timestamptz default now()
);

-- ─── FLASHCARDS ───────────────────────────────────────────────
create table if not exists flashcards (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references profiles(id) on delete cascade,
  subject     text,
  front       text not null,
  back        text not null,
  next_review date default current_date,
  ease        integer default 2,
  created_at  timestamptz default now()
);

-- ─── MISTAKES TRACKER ─────────────────────────────────────────
create table if not exists mistakes (
  id        uuid default gen_random_uuid() primary key,
  user_id   uuid references profiles(id) on delete cascade,
  subject   text,
  topic     text,
  question  text,
  count     integer default 1,
  last_seen timestamptz default now(),
  unique(user_id, subject, topic, question)
);

-- ─── EXAMS ────────────────────────────────────────────────────
create table if not exists exams (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references profiles(id) on delete cascade,
  subject    text not null,
  board      text,
  exam_date  date not null,
  created_at timestamptz default now()
);

-- ─── ACTIVITY LOG (heatmap) ───────────────────────────────────
create table if not exists activity_log (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references profiles(id) on delete cascade,
  date            date default current_date,
  minutes_studied integer default 0,
  questions_done  integer default 0,
  xp_earned       integer default 0
);

-- ─── WEBHOOK IDEMPOTENCY ──────────────────────────────────────
-- Prevents duplicate processing of Stripe webhook events
create table if not exists processed_webhooks (
  id           text primary key,             -- Stripe event ID (evt_...)
  processed_at timestamptz default now()
);

-- Auto-clean old webhook records after 90 days (keeps table small)
create index if not exists processed_webhooks_age_idx on processed_webhooks (processed_at);

-- ─── ADMIN AUDIT LOG ──────────────────────────────────────────
create table if not exists admin_audit_log (
  id           uuid default gen_random_uuid() primary key,
  action       text not null,
  performed_at timestamptz default now(),
  details      jsonb
);

-- ─── RPC: increment user stats atomically ────────────────────
create or replace function increment_user_stats(uid uuid, xp_add integer, questions_add integer)
returns void language plpgsql as $$
begin
  update profiles set
    xp                 = xp + xp_add,
    questions_answered = questions_answered + questions_add,
    level              = greatest(1, floor((xp + xp_add) / 200)::integer + 1),
    last_active        = current_date
  where id = uid;
end;
$$;

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
alter table profiles         enable row level security;
alter table progress         enable row level security;
alter table notes            enable row level security;
alter table chat_history     enable row level security;
alter table flashcards       enable row level security;
alter table mistakes         enable row level security;
alter table exams            enable row level security;
alter table activity_log     enable row level security;
-- processed_webhooks and admin_audit_log are service-key only; no RLS needed.

-- Policies: users can only see their own data
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Own profile') then
    create policy "Own profile"    on profiles     for all using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Own progress') then
    create policy "Own progress"   on progress     for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Own notes') then
    create policy "Own notes"      on notes        for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Own history') then
    create policy "Own history"    on chat_history for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Own flashcards') then
    create policy "Own flashcards" on flashcards   for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Own mistakes') then
    create policy "Own mistakes"   on mistakes     for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Own exams') then
    create policy "Own exams"      on exams        for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Own activity') then
    create policy "Own activity"   on activity_log for all using (auth.uid() = user_id);
  end if;
end $$;
