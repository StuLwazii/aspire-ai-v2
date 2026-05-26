
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Backfill resolved_at from updated_at for already-resolved tickets
UPDATE public.tickets
  SET resolved_at = updated_at
  WHERE status = 'resolved' AND resolved_at IS NULL;

-- Backfill first_response_at from earliest assistant/admin conversation message
UPDATE public.tickets t
  SET first_response_at = sub.first_at
  FROM (
    SELECT ticket_id, MIN(created_at) AS first_at
    FROM public.conversations
    WHERE role IN ('assistant', 'admin', 'agent')
    GROUP BY ticket_id
  ) sub
  WHERE sub.ticket_id = t.id AND t.first_response_at IS NULL;

-- Trigger: set resolved_at when status becomes 'resolved'
CREATE OR REPLACE FUNCTION public.set_ticket_resolved_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'resolved' AND (OLD.status IS DISTINCT FROM 'resolved') AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at = now();
  END IF;
  IF NEW.status <> 'resolved' AND OLD.status = 'resolved' THEN
    NEW.resolved_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_resolved_at ON public.tickets;
CREATE TRIGGER trg_tickets_resolved_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_ticket_resolved_at();

-- Trigger: set first_response_at on first non-user conversation message
CREATE OR REPLACE FUNCTION public.set_ticket_first_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('assistant', 'admin', 'agent') THEN
    UPDATE public.tickets
      SET first_response_at = NEW.created_at
      WHERE id = NEW.ticket_id AND first_response_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversations_first_response ON public.conversations;
CREATE TRIGGER trg_conversations_first_response
  AFTER INSERT ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_ticket_first_response();
