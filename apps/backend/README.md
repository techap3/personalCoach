# Backend

Express + TypeScript API for goals, tasks, summaries, and adaptation flows.

## Requirements

- Node.js 20+
- pnpm

## Setup

```bash
pnpm install
```

Create `apps/backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
DATABASE_URL=postgresql://postgres:password@db.host:5432/postgres?sslmode=require
OPENROUTER_API_KEY=sk-or-...
AI_PROVIDER=openrouter
```

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm migrate
pnpm test
pnpm test:watch
```

## Main routes

- `GET /health`
- `POST /goals`
- `GET /goals`
- `POST /tasks/generate`
- `POST /tasks/update`
- `GET /tasks/daily-summary`
- `POST /tasks/adapt`
