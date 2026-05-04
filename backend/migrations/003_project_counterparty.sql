-- Counterparty fields on projects. The counterparty is the *other* side of
-- the agreement (the vendor for vendor contracts, the customer for customer
-- contracts). parent_counterparty supports corporate hierarchy ("Stripe Inc."
-- under "Stripe Holdings") for the customer index. Both are free text now;
-- a future migration may promote them to a dedicated counterparties table
-- with aliases and fuzzy reconciliation.

alter table public.projects
  add column if not exists counterparty text,
  add column if not exists parent_counterparty text;

create index if not exists idx_projects_counterparty
  on public.projects(counterparty);
create index if not exists idx_projects_parent_counterparty
  on public.projects(parent_counterparty);
