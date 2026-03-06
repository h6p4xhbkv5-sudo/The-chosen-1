-- ══════════════════════════════════════════
-- LUMINA AI — SUPABASE DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════

-- PROFILES (one per user)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  name text,
  email text,
  plan text default 'free',
  subscription_status text default 'free',
  stripe_customer_id text,
  subscription_id text,
  learning_difficulty text default 'none',
  year_group text,
  subjects text[],
  xp integer default 0,
  level integer default 1,
  streak integer default 0,
  longest_streak integer default 0,
  questions_answered integer default 0,
  accuracy integer default 0,
  last_active date,
  created_at timestamptz default now()
);

-- PROGRESS (per subject/topic)
create table progress (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  subject text,
  topic text,
  accuracy integer default 0,
  questions_done integer default 0,
  last_practiced timestamptz default now(),
  unique(user_id, subject, topic)
);

-- NOTES
create table notes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  text text,
  subject text,
  tag text,
  created_at timestamptz default now()
);

-- CHAT HISTORY
create table chat_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  subject text,
  question text,
  answer text,
  created_at timestamptz default now()
);

-- FLASHCARDS
create table flashcards (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  subject text,
  front text,
  back text,
  next_review date default current_date,
  ease integer default 2,
  created_at timestamptz default now()
);

-- MISTAKES TRACKER
create table mistakes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  subject text,
  topic text,
  question text,
  count integer default 1,
  last_seen timestamptz default now(),
  unique(user_id, subject, topic, question)
);

-- EXAMS
create table exams (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  subject text,
  board text,
  exam_date date,
  created_at timestamptz default now()
);

-- DAILY ACTIVITY (for heatmap)
create table activity_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  date date default current_date,
  minutes_studied integer default 0,
  questions_done integer default 0,
  xp_earned integer default 0
);

-- RPC: increment user stats atomically
create or replace function increment_user_stats(uid uuid, xp_add integer, questions_add integer)
returns void language plpgsql as $$
begin
  update profiles set
    xp = xp + xp_add,
    questions_answered = questions_answered + questions_add,
    level = greatest(1, floor((xp + xp_add) / 500)::integer + 1),
    last_active = current_date
  where id = uid;
end;
$$;

-- Row Level Security
alter table profiles enable row level security;
alter table progress enable row level security;
alter table notes enable row level security;
alter table chat_history enable row level security;
alter table flashcards enable row level security;
alter table mistakes enable row level security;
alter table exams enable row level security;
alter table activity_log enable row level security;

-- Policies: users can only see their own data
create policy "Own profile" on profiles for all using (auth.uid() = id);
create policy "Own progress" on progress for all using (auth.uid() = user_id);
create policy "Own notes" on notes for all using (auth.uid() = user_id);
create policy "Own history" on chat_history for all using (auth.uid() = user_id);
create policy "Own cards" on flashcards for all using (auth.uid() = user_id);
create policy "Own mistakes" on mistakes for all using (auth.uid() = user_id);
create policy "Own exams" on exams for all using (auth.uid() = user_id);
create policy "Own activity" on activity_log for all using (auth.uid() = user_id);
