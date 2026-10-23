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
-- ==========================================
-- 1. EXTENSIONS & PROFILES TABLE
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    username TEXT UNIQUE NOT NULL,
    avatar_url TEXT,
    total_games_played INTEGER DEFAULT 0,
    highest_score INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Trigger function to automatically create/update profile details on Auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, first_name, last_name, email, username, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.raw_user_meta_data->>'full_name', ' ', 1), ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', split_part(NEW.raw_user_meta_data->>'full_name', ' ', 2), ''),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create the trigger safely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ==========================================
-- 2. LEADERBOARD TABLE (Active & Historical Seasons)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.leaderboard (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'expert', -- 'easy', 'medium', 'expert'
    region TEXT NOT NULL DEFAULT 'Asia',
    streak INTEGER NOT NULL DEFAULT 0,
    season_type TEXT NOT NULL DEFAULT 'all_time', -- 'weekly', 'monthly', 'all_time'
    season_identifier TEXT NOT NULL DEFAULT 'global', -- e.g., '2026-W43', '2026-10', or 'global'
    is_archived BOOLEAN DEFAULT FALSE, -- Flag for past completed seasons
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, mode, region, season_type, season_identifier)
);

-- Indexes for fast query execution on active rankings and historical archives
CREATE INDEX IF NOT EXISTS idx_seasonal_leaderboard 
ON public.leaderboard (season_type, season_identifier, mode, region, score DESC);

CREATE INDEX IF NOT EXISTS idx_archived_leaderboard 
ON public.leaderboard (is_archived, season_type, season_identifier);


-- ==========================================
-- 3. ACHIEVEMENTS & USER UNLOCKS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.achievements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key_name TEXT UNIQUE NOT NULL, -- e.g., 'FIRST_WIN', 'STREAK_10', 'EXPERT_MASTER'
    title TEXT NOT NULL,
    description TEXT,
    multiplier DECIMAL(3,2) DEFAULT 1.00, -- Score boost multiplier (e.g., 1.15 = 15% boost)
    icon TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_achievements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    achievement_id UUID REFERENCES public.achievements(id) ON DELETE CASCADE NOT NULL,
    unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, achievement_id)
);


-- ==========================================
-- 4. DEFAULT ACHIEVEMENTS SEED DATA
-- ==========================================
INSERT INTO public.achievements (key_name, title, description, multiplier, icon)
VALUES 
    ('FIRST_GAME', 'First Step', 'Played your first game', 1.00, 'flag'),
    ('STREAK_5', 'On Fire', 'Achieved a 5-game winning streak', 1.05, 'fire'),
    ('EASY_MASTER', 'Speed Demon', 'Completed Easy mode with high score', 1.10, 'zap'),
    ('EXPERT_PERFECT', 'Flash Legend', 'Completed Expert mode perfectly', 1.25, 'crown')
ON CONFLICT (key_name) DO NOTHING;


-- ==========================================
-- 5. ROW LEVEL SECURITY (RLS) & POLICIES
-- ==========================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles are viewable by everyone." 
ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile." 
ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Leaderboard Policies
CREATE POLICY "Leaderboard is viewable by everyone." 
ON public.leaderboard FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert/update scores." 
ON public.leaderboard FOR ALL 
TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

-- Achievement Policies
CREATE POLICY "Achievements are viewable by everyone." 
ON public.achievements FOR SELECT USING (true);

CREATE POLICY "User achievements are viewable by everyone." 
ON public.user_achievements FOR SELECT USING (true);

CREATE POLICY "Authenticated users can unlock achievements." 
ON public.user_achievements FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);


```
---

## 🚀 Quick Start Commands

```bash
# Install dependencies
npm install

# Start development server locally
npm run dev

```
