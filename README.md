# ⚡ Number Flash — Backend API

A Node.js and Express serverless backend for **Number Flash**. It handles core backend logic, leaderboard scores, achievement processing, and user synchronization with **Supabase (PostgreSQL)**.

---

## 🛠️ Tech Stack

- **Runtime & Server**: Node.js, Express.js
- **Database & Auth**: Supabase (PostgreSQL)
- **Deployment**: Vercel Serverless Functions
- **Frontend Repository**: [Number Flash Frontend GitHub Repository](https://github.com/Arman-Saif/Flash-Memory-Codyza)

---

## ⚙️ Environment Configuration (`.env.example`)

Create a `.env` file in the root directory:

```env
PORT=5000
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
CLIENT_ORIGIN=https://memoryflash.vercel.app
```
## SQL editor code
```SQL
-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- ==========================================
-- 1. TABLES CREATION
-- ==========================================

create table public.profiles (
  id uuid not null references auth.users on delete cascade primary key,
  first_name text,
  last_name text,
  email text,
  profile_url text unique,
  avatar_url text,
  streak integer default 0,
  streak_seasons integer default 0,
  rank text default 'UNRANKED',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.leaderboard (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  username text,
  mode text not null,
  score integer not null,
  region text default 'Asia',
  season_started_at timestamp with time zone,
  season_ends_at timestamp with time zone,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint leaderboard_user_mode_key unique (user_id, mode)
);

create table public.user_achievements (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_name text not null,
  multiplier numeric default 1.0,
  unlocked_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.user_stats (
  user_id uuid not null references public.profiles(id) on delete cascade primary key,
  current_streak integer default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.leaderboard_archives (
  id uuid default uuid_generate_v4() primary key,
  season_type text not null,
  mode text not null,
  user_id uuid not null,
  username text,
  score integer not null,
  region text,
  archived_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ==========================================
-- 2. ENABLE ROW LEVEL SECURITY (RLS)
-- ==========================================

alter table public.profiles enable row level security;
alter table public.leaderboard enable row level security;
alter table public.user_achievements enable row level security;
alter table public.user_stats enable row level security;
alter table public.leaderboard_archives enable row level security;

-- ==========================================
-- 3. RLS POLICIES
-- ==========================================

-- --- PROFILES POLICIES ---
-- Anyone can view profiles (needed for public profile pages and leaderboards)
create policy "Public profiles are viewable by everyone."
  on public.profiles for select
  using (true);

-- Users can insert their own profile
create policy "Users can insert their own profile."
  on public.profiles for insert
  with check (auth.uid() = id);

-- Users can update only their own profile
create policy "Users can update their own profile."
  on public.profiles for update
  using (auth.uid() = id);


-- --- LEADERBOARD POLICIES ---
-- Anyone can view the leaderboard rankings
create policy "Leaderboard entries are viewable by everyone."
  on public.leaderboard for select
  using (true);

-- Users can insert or update their own scores
create policy "Users can manage their own leaderboard entries."
  on public.leaderboard for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- --- USER ACHIEVEMENTS POLICIES ---
-- Achievements can be viewed publicly or by the owner
create policy "Achievements are viewable by everyone."
  on public.user_achievements for select
  using (true);


-- --- USER STATS POLICIES ---
-- Stats can be viewed publicly (for streaks on profile cards)
create policy "User stats are viewable by everyone."
  on public.user_stats for select
  using (true);


-- --- LEADERBOARD ARCHIVES POLICIES ---
-- Hall of fame archives are viewable by everyone
create policy "Archives are viewable by everyone."
  on public.leaderboard_archives for select
  using (true);
```
---

## 🚀 Quick Start Commands

```bash
# Install dependencies
npm install

# Start development server locally
npm run server

```
