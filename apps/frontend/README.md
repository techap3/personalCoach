# Frontend — AI Personal Coach

Next.js (App Router) single-page app. Handles authentication, goal creation, plan visualization, daily tasks, and progress tracking.

---

## Stack

- Next.js 16, React 19, Tailwind CSS v4
- Supabase Auth (magic link / social)

---

## Setup

```bash
pnpm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

```bash
pnpm dev      # http://localhost:3000
pnpm build    # production build
pnpm lint     # ESLint
```
