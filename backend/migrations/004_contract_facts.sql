-- Structured facts extracted from each contract document. One row per
-- (document, document_version) capture so that re-uploads and renewals
-- produce a timeline of how key terms changed.
--
-- Free-text amounts (e.g. "$1.2M") are normalized into total_value_minor +
-- currency so we can sum / chart them. Original strings preserved on
-- raw_extraction for auditability.

create table if not exists public.contract_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid references public.document_versions(id) on delete cascade,
  effective_date date,
  term_months integer,
  -- Total contract value in *minor* units (cents) so we can store integers.
  -- Display layer divides by 100 and adds the currency.
  total_value_minor bigint,
  currency text,
  auto_renew boolean,
  notice_days integer,
  governing_law text,
  raw_extraction jsonb,
  model text,
  extracted_at timestamptz not null default now()
);

create index if not exists idx_contract_facts_project
  on public.contract_facts(project_id, extracted_at desc);
create index if not exists idx_contract_facts_document
  on public.contract_facts(document_id, extracted_at desc);
