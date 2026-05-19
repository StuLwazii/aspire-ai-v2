
-- Resolution type enum
DO $$ BEGIN
  CREATE TYPE public.resolution_type AS ENUM ('self_service', 'escalated', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_status AS ENUM ('available', 'busy', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend ticket_status to include escalated / in_progress
DO $$ BEGIN
  ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'escalated';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'in_progress';
EXCEPTION WHEN others THEN NULL; END $$;

-- Agents table
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL CHECK (department IN ('IT','HR','Finance','Operations')),
  status public.agent_status NOT NULL DEFAULT 'available',
  current_ticket_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage agents" ON public.agents;
CREATE POLICY "admins manage agents" ON public.agents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tickets: new columns
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS resolution_type public.resolution_type NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority public.ticket_priority NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS classification_method TEXT NOT NULL DEFAULT 'AI',
  ADD COLUMN IF NOT EXISTS resolved_by_user BOOLEAN NOT NULL DEFAULT false;

-- Seed default agents
INSERT INTO public.agents (full_name, email, department) VALUES
  ('IT Support Agent', 'it.support@helpdesk.com', 'IT'),
  ('HR Agent', 'hr@helpdesk.com', 'HR'),
  ('Finance Agent', 'finance@helpdesk.com', 'Finance'),
  ('Operations Agent', 'operations@helpdesk.com', 'Operations')
ON CONFLICT (email) DO NOTHING;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
