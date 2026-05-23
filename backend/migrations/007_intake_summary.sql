-- Add a 1-2 sentence LLM summary of each document, captured at intake time.
-- Surfaced in the per-counterparty timeline so users see what each agreement
-- actually says without opening it.

alter table public.documents
  add column if not exists intake_summary text;
