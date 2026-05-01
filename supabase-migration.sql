-- Run this SQL in Supabase Dashboard > SQL Editor (project: tetzhzolintcrdspneet)
-- Idempotent: safe to re-run

-- =====================================================================
-- USERS - profil + credit + voice_id
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  phone_number TEXT,         -- numarul personal (info, nu Twilio)
  phone_verified BOOLEAN DEFAULT FALSE,
  voice_id TEXT,
  -- Numarul AiCall (Twilio) cumparat de user prin app
  twilio_phone_number TEXT,            -- ex: '+447700900123'
  twilio_phone_sid TEXT,               -- 'PNxxxx' pt API management
  twilio_phone_country TEXT,           -- 'GB', 'US', 'DE'
  twilio_phone_type TEXT,              -- 'local', 'mobile', 'tollfree'
  twilio_phone_monthly_cents INTEGER,  -- cost lunar
  twilio_phone_purchased_at TIMESTAMPTZ,
  twilio_phone_next_charge_at TIMESTAMPTZ,
  -- Credit in cents (precizie billing). 100 cents = 1 USD
  credit_cents INTEGER NOT NULL DEFAULT 0,
  -- Limite hard
  max_minutes_per_day INTEGER DEFAULT 120,
  max_minutes_per_month INTEGER DEFAULT 2400,
  -- Tracking
  total_minutes_this_month INTEGER DEFAULT 0,
  total_minutes_today INTEGER DEFAULT 0,
  last_call_date DATE,
  -- Default language
  default_language TEXT DEFAULT 'RO',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_twilio_phone
  ON public.users(twilio_phone_number) WHERE twilio_phone_number IS NOT NULL;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own profile" ON public.users;
CREATE POLICY "Users can manage own profile" ON public.users
  FOR ALL USING (auth.uid() = id);

-- =====================================================================
-- CONTACTS - cu mod traducere
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  -- Mod traducere: 'auto' (intreaba), 'never' (NU traduce), 'always' (traduce mereu)
  translation_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (translation_mode IN ('auto', 'never', 'always')),
  -- Limba preferata (cand always): 'EN', 'DE', 'FR', 'ES', 'IT', 'RO'
  preferred_language TEXT,
  -- Auto-learning din istoric: cate apeluri a folosit cu/fara traducere
  calls_with_translation INTEGER DEFAULT 0,
  calls_without_translation INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own contacts" ON public.contacts;
CREATE POLICY "Users can manage own contacts" ON public.contacts
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON public.contacts(user_id, phone_number);

-- =====================================================================
-- CALL HISTORY - apeluri terminate (pentru istoric, billing audit)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.call_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Twilio call SID pentru reconciliere
  twilio_call_sid TEXT,
  phone_number TEXT NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_name TEXT,
  direction TEXT DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound')),
  duration_seconds INTEGER DEFAULT 0,
  -- Limba detectata pe interlocutor
  detected_language TEXT,
  -- Daca s-a folosit traducere
  used_translation BOOLEAN DEFAULT TRUE,
  -- Cost real in cents (poate diferi de pret/min daca esueaza componente)
  cost_cents INTEGER DEFAULT 0,
  -- Status final
  status TEXT DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed', 'no-answer', 'cancelled', 'busy')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.call_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own history" ON public.call_history;
CREATE POLICY "Users can manage own history" ON public.call_history
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_call_history_user_date
  ON public.call_history(user_id, created_at DESC);

-- =====================================================================
-- CALL SESSIONS - apeluri ACTIVE (live billing per minut)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.call_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  twilio_call_sid TEXT UNIQUE,
  phone_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  used_translation BOOLEAN DEFAULT TRUE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ultima oara cand am facut deduct (la fiecare 15s)
  last_billed_at TIMESTAMPTZ DEFAULT NOW(),
  total_billed_cents INTEGER DEFAULT 0,
  -- Avertismente trimise (sa nu se repete)
  warning_15min_sent BOOLEAN DEFAULT FALSE,
  warning_5min_sent BOOLEAN DEFAULT FALSE,
  ended_at TIMESTAMPTZ
);
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own sessions" ON public.call_sessions;
CREATE POLICY "Users can read own sessions" ON public.call_sessions
  FOR SELECT USING (auth.uid() = user_id);
-- Backend foloseste service_role, bypass RLS

CREATE INDEX IF NOT EXISTS idx_sessions_active
  ON public.call_sessions(user_id) WHERE ended_at IS NULL;

-- =====================================================================
-- CREDIT TRANSACTIONS - audit log incarcare/cheltuieli
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'topup' (incarcare), 'call' (apel), 'refund', 'adjustment'
  type TEXT NOT NULL CHECK (type IN ('topup', 'call', 'refund', 'adjustment', 'phone_purchase', 'phone_monthly')),
  amount_cents INTEGER NOT NULL,
  -- Pozitiv = adaugare, Negativ = scadere
  balance_after_cents INTEGER NOT NULL,
  call_session_id UUID REFERENCES public.call_sessions(id) ON DELETE SET NULL,
  description TEXT,
  -- Stripe payment intent id, sau alt provider
  external_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own transactions" ON public.credit_transactions;
CREATE POLICY "Users can read own transactions" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_credit_tx_user_date
  ON public.credit_transactions(user_id, created_at DESC);

-- =====================================================================
-- TRIGGER: Pe insert auth.users -> creeaza users row + bonus 30min
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, credit_cents)
  VALUES (NEW.id, NEW.email, 240) -- 240 cents = $2.40 = ~30 min trial
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.credit_transactions (user_id, type, amount_cents, balance_after_cents, description)
  VALUES (NEW.id, 'topup', 240, 240, 'Trial gratuit 30 min')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- FUNCTION: Reset zilnic minute (apeleaza-l din cron sau la start de apel)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reset_daily_minutes_if_needed(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users
  SET total_minutes_today = 0,
      last_call_date = CURRENT_DATE
  WHERE id = p_user_id
    AND (last_call_date IS NULL OR last_call_date < CURRENT_DATE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
