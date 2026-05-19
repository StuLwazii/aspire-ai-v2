-- Drop permissive policies; rely on server functions (admin client) for all public writes
DROP POLICY IF EXISTS "anyone can insert app_users" ON public.app_users;
DROP POLICY IF EXISTS "anyone can insert tickets" ON public.tickets;
DROP POLICY IF EXISTS "anyone can select tickets" ON public.tickets;
DROP POLICY IF EXISTS "anyone can rate tickets" ON public.tickets;
DROP POLICY IF EXISTS "anyone can insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "anyone can select conversations" ON public.conversations;

-- Admin-only direct access on these tables
CREATE POLICY "admins select tickets" ON public.tickets FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update tickets" ON public.tickets FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins select conversations" ON public.conversations FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Lock down has_role exec to server roles only (service_role bypasses anyway)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated, public;