-- Run this SQL in Supabase Dashboard > SQL Editor

-- Contacts table
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own contacts" ON public.contacts
  FOR ALL USING (auth.uid() = user_id);

-- Users table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  phone_number TEXT,
  phone_verified BOOLEAN DEFAULT FALSE,
  voice_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own profile" ON public.users
  FOR ALL USING (auth.uid() = id);

-- Call history table
CREATE TABLE IF NOT EXISTS public.call_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  direction TEXT DEFAULT 'outbound',
  duration INTEGER DEFAULT 0,
  detected_language TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.call_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own history" ON public.call_history
  FOR ALL USING (auth.uid() = user_id);
