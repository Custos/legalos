# LegalOS

Contract review and document analysis platform with multi-model AI extraction, tabular review, and Supabase-backed storage.

## Origin and attribution

LegalOS is a fork of [willchen96/mike](https://github.com/willchen96/mike), continuing under the original AGPL-3.0-only license. Modifications by [Custos](https://github.com/Custos) are released under the same license. Source code is available at https://github.com/Custos/legalos.

## Contents

- `frontend/` — Next.js application
- `backend/` — Express API, Supabase access, document processing, and migrations
- `backend/migrations/000_one_shot_schema.sql` — one-shot Supabase schema for fresh databases

## Setup

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend --legacy-peer-deps
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run `backend/migrations/000_one_shot_schema.sql` in the Supabase SQL editor for a fresh database.

Start the backend (logs to file):

```bash
cd backend && npm run dev 2>&1 | tee /tmp/mike-backend.log
```

Start the frontend (logs to file):

```bash
cd frontend && npm run dev 2>&1 | tee /tmp/mike-frontend.log
```

Open `http://localhost:3000`.

## Required services

- Supabase Auth, Postgres, and Storage (S3-compatible endpoint)
- At least one supported model provider key (Gemini, Anthropic, or xAI/Grok)
- LibreOffice for DOC/DOCX to PDF conversion (`brew install --cask libreoffice` on macOS)

## Supported models

- **Anthropic:** Claude Opus 4.7, Claude Sonnet 4.6, Claude Haiku 4.5
- **Google:** Gemini 3.1 Pro, Gemini 3 Flash, Gemini 3.1 Flash Lite
- **xAI:** Grok 4.3

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3. Network use of a modified version requires source code disclosure to users — keep this in mind when deploying.
