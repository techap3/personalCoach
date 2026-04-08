# AI Personal Coach

AI coaching app with a Next.js frontend and Express + TypeScript backend.

## Structure

- `apps/frontend` - UI (Next.js)
- `apps/backend` - API (Express)

## Requirements

- Node.js 20+
- pnpm
- Supabase project
- OpenAI or OpenRouter API key

## Install

```bash
pnpm -C apps/backend install
pnpm -C apps/frontend install
```

## Environment

Create `apps/backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
DATABASE_URL=postgresql://postgres:password@db.host:5432/postgres?sslmode=require
OPENROUTER_API_KEY=sk-or-...
AI_PROVIDER=openrouter
```

Create `apps/frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

## Run

```bash
pnpm -C apps/backend dev
pnpm -C apps/frontend dev
```

Frontend: http://localhost:3000
Backend: http://localhost:3001
