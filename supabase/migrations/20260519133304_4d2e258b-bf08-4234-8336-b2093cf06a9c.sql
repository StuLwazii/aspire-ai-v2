-- Drop old tickets table
DROP TABLE IF EXISTS public.tickets CASCADE;

-- App users (public chat submitters, no auth)
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  department text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_app_users_email ON public.app_users(email);

-- Rating enum
DO $$ BEGIN
  CREATE TYPE public.ticket_rating AS ENUM ('up','down');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tickets
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  message text NOT NULL,
  category public.ticket_category NOT NULL,
  ai_response text,
  status public.ticket_status NOT NULL DEFAULT 'open',
  rating public.ticket_rating,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_created_at ON public.tickets(created_at DESC);
CREATE INDEX idx_tickets_status ON public.tickets(status);
CREATE INDEX idx_tickets_category ON public.tickets(category);

CREATE TRIGGER tickets_set_updated_at
BEFORE UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Conversations (multi-turn chat)
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_ticket_id ON public.conversations(ticket_id, created_at);

-- Roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Enable RLS
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- app_users: public insert + admin select
CREATE POLICY "anyone can insert app_users" ON public.app_users FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "admins read app_users" ON public.app_users FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- tickets: public insert + admin manage; public can select own ticket by id (via server fn)
CREATE POLICY "anyone can insert tickets" ON public.tickets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anyone can select tickets" ON public.tickets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anyone can rate tickets" ON public.tickets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admins delete tickets" ON public.tickets FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- conversations: public insert + select
CREATE POLICY "anyone can insert conversations" ON public.conversations FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anyone can select conversations" ON public.conversations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins delete conversations" ON public.conversations FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- user_roles
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER TABLE public.tickets REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;