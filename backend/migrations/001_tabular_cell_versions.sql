-- Track which model and prompts produced each cell's current content,
-- and archive prior state to a versions table on every overwrite. Enables
-- diffs, model comparison, and lifecycle inspection.
alter table public.tabular_cells
  add column if not exists model text,
  add column if not exists system_prompt text,
  add column if not exists column_prompt text,
  add column if not exists updated_at timestamptz not null default now();

-- Versioned history for tabular_cells. Each row captures the state of a cell
-- *before* it was overwritten by a re-run, plus the model and prompts that
-- produced that prior content.

create table if not exists public.tabular_cell_versions (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null references public.tabular_cells(id) on delete cascade,
  review_id uuid not null references public.tabular_reviews(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  column_index integer not null,
  content text,
  status text,
  citations jsonb,
  model text,
  system_prompt text,
  column_prompt text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tabular_cell_versions_cell
  on public.tabular_cell_versions(cell_id, created_at desc);

create index if not exists idx_tabular_cell_versions_review
  on public.tabular_cell_versions(review_id, created_at desc);
