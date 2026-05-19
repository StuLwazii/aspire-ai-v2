
CREATE TYPE public.ticket_category AS ENUM ('HR','IT','Finance','Operations');
CREATE TYPE public.ticket_status AS ENUM ('open','in_progress','resolved');
CREATE TYPE public.ticket_tone AS ENUM ('formal','friendly','urgent');

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  category public.ticket_category NOT NULL,
  tone public.ticket_tone NOT NULL DEFAULT 'formal',
  ai_response text,
  status public.ticket_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own tickets" ON public.tickets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own tickets" ON public.tickets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own tickets" ON public.tickets FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users delete own tickets" ON public.tickets FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER tickets_set_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX tickets_user_id_created_at_idx ON public.tickets (user_id, created_at DESC);
