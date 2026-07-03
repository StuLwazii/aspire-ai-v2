
CREATE TABLE public.ai_error_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  function_name TEXT NOT NULL,
  ticket_id UUID,
  conversation_id UUID,
  attempts INTEGER NOT NULL DEFAULT 1,
  alert_triggered BOOLEAN NOT NULL DEFAULT false,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_error_logs_occurred_at_idx ON public.ai_error_logs (occurred_at DESC);
CREATE INDEX ai_error_logs_type_idx ON public.ai_error_logs (error_type);

GRANT SELECT ON public.ai_error_logs TO authenticated;
GRANT ALL ON public.ai_error_logs TO service_role;

ALTER TABLE public.ai_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view AI error logs"
  ON public.ai_error_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
