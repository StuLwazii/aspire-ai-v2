
-- Business Reporting Automation module

CREATE TABLE public.business_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department text NOT NULL DEFAULT 'All',
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  executive_summary text NOT NULL,
  performance_analysis text NOT NULL,
  recommendations text NOT NULL,
  kpis jsonb NOT NULL DEFAULT '{}'::jsonb,
  html text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_reports TO authenticated;
GRANT ALL ON public.business_reports TO service_role;

ALTER TABLE public.business_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage business_reports"
  ON public.business_reports FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_business_reports_created ON public.business_reports (created_at DESC);
CREATE INDEX idx_business_reports_department ON public.business_reports (department);


CREATE TABLE public.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department text NOT NULL DEFAULT 'All',
  cadence text NOT NULL DEFAULT 'weekly',
  recipients text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_schedules TO authenticated;
GRANT ALL ON public.report_schedules TO service_role;

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage report_schedules"
  ON public.report_schedules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_report_schedules_updated
  BEFORE UPDATE ON public.report_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
