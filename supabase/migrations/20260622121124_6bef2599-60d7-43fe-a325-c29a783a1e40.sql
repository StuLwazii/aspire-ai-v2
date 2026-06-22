
CREATE TABLE public.compliance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level VARCHAR(20) NOT NULL DEFAULT 'Low',
  identified_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  compliance_status VARCHAR(30) NOT NULL DEFAULT 'Pending Review',
  review_notes TEXT,
  transparency_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  source VARCHAR(40) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_logs TO authenticated;
GRANT ALL ON public.compliance_logs TO service_role;

ALTER TABLE public.compliance_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view compliance logs"
  ON public.compliance_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert compliance logs"
  ON public.compliance_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update compliance logs"
  ON public.compliance_logs FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete compliance logs"
  ON public.compliance_logs FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_compliance_logs_created_at ON public.compliance_logs (created_at DESC);
CREATE INDEX idx_compliance_logs_risk_level ON public.compliance_logs (risk_level);
CREATE INDEX idx_compliance_logs_compliance_status ON public.compliance_logs (compliance_status);
CREATE INDEX idx_compliance_logs_user_id ON public.compliance_logs (user_id);

CREATE TRIGGER set_compliance_logs_updated_at
  BEFORE UPDATE ON public.compliance_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
