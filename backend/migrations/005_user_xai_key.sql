-- Per-user xAI (Grok) API key, mirrors claude_api_key / gemini_api_key.
alter table public.user_profiles
  add column if not exists xai_api_key text;
