-- Document intake/triage. When a document is uploaded without a project
-- (bulk intake flow), an LLM call classifies it: vendor vs customer, draft
-- vs execution copy, lifecycle position. The result lands in these columns
-- and the document waits in /intake until the user assigns it to a project.

alter table public.documents
  add column if not exists intake_role text check (
    intake_role in ('buyer', 'seller', 'mutual')
  ),
  add column if not exists intake_status text check (
    intake_status in ('draft', 'execution', 'unknown')
  ),
  add column if not exists intake_counterparty text,
  add column if not exists intake_parent_counterparty text,
  add column if not exists intake_lifecycle_hint text,
  add column if not exists intake_confidence numeric(3, 2),
  add column if not exists intake_analyzed_at timestamptz;

create index if not exists idx_documents_intake_pending
  on public.documents (user_id, intake_analyzed_at desc)
  where project_id is null;
create index if not exists idx_documents_intake_counterparty
  on public.documents (intake_counterparty)
  where intake_counterparty is not null;
