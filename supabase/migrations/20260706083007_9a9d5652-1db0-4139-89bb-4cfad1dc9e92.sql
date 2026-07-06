
-- 1. Agents self-select
CREATE POLICY "agents view own record" ON public.agents
FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- 2. Tickets: user self-access (matched via email on app_users)
CREATE POLICY "users view own tickets" ON public.tickets
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = tickets.user_id
      AND lower(u.email) = lower(auth.jwt() ->> 'email')
  )
);

CREATE POLICY "users insert own tickets" ON public.tickets
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = tickets.user_id
      AND lower(u.email) = lower(auth.jwt() ->> 'email')
  )
);

CREATE POLICY "users update own tickets" ON public.tickets
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = tickets.user_id
      AND lower(u.email) = lower(auth.jwt() ->> 'email')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = tickets.user_id
      AND lower(u.email) = lower(auth.jwt() ->> 'email')
  )
);

-- 3. Conversations: users view messages in their own tickets
CREATE POLICY "users view own conversations" ON public.conversations
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.app_users u ON u.id = t.user_id
    WHERE t.id = conversations.ticket_id
      AND lower(u.email) = lower(auth.jwt() ->> 'email')
  )
);

-- 4. Lock down SECURITY DEFINER functions from being directly callable by anon/authenticated.
-- has_role is used inside RLS policies as auth.uid() = self, so SECURITY INVOKER still works
-- because "users read own roles" policy allows each user to see their own row.
ALTER FUNCTION public.has_role(uuid, public.app_role) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

-- assign_first_user_admin is a trigger function; direct EXECUTE is not needed by clients.
REVOKE EXECUTE ON FUNCTION public.assign_first_user_admin() FROM PUBLIC, anon, authenticated;
