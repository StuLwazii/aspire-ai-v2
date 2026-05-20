
-- 1. Add 'agent' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'agent';

-- 2. Add title to tickets
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS title text;

-- 3. Link agents to auth.users so agents can log in
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS agents_user_id_unique ON public.agents(user_id) WHERE user_id IS NOT NULL;
