# Frontend

Next.js app for onboarding, goals, and daily task flows.

## Requirements

- Node.js 20+
- pnpm

## Setup

```bash
pnpm install
```

Create `apps/frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm test
```
