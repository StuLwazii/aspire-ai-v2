alter table public.compliance_logs
  add column if not exists ticket_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists sender text,
  add column if not exists message_preview text,
  add column if not exists sentiment text,
  add column if not exists pii_detected jsonb not null default '[]'::jsonb,
  add column if not exists governance_explanation text,
  add column if not exists action_taken text,
  add column if not exists status_label text;

alter table public.compliance_logs alter column prompt drop not null;
alter table public.compliance_logs alter column response drop not null;

create index if not exists compliance_logs_ticket_id_idx on public.compliance_logs (ticket_id);
create index if not exists compliance_logs_conversation_id_idx on public.compliance_logs (conversation_id);
create index if not exists compliance_logs_sender_idx on public.compliance_logs (sender);
create unique index if not exists compliance_logs_conversation_id_uniq
  on public.compliance_logs (conversation_id)
  where conversation_id is not null;