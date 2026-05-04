-- Project templates: classify projects so the UI can group/filter by contract
-- type (vendor, customer, internal) and so future features (counterparty
-- extraction, lifecycle reports) know which side of the deal "we" are on.
--
-- Templates are referenced by slug. The slug→config mapping lives in code so
-- product can iterate without a migration; only the slug is persisted.
--
-- role indicates which side of the agreement the project owner sits on.
--   buyer   = we are the customer / spender (vendor contracts)
--   seller  = we are the vendor / earner (customer contracts)
--   mutual  = NDAs, partnerships, anything two-sided

alter table public.projects
  add column if not exists template text,
  add column if not exists role text check (role in ('buyer', 'seller', 'mutual'));

create index if not exists idx_projects_template on public.projects(template);
create index if not exists idx_projects_role on public.projects(role);
