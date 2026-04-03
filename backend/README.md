# Backend — AI Personal Coach

Express.js REST API powering goal creation, AI plan generation, daily task sessions, step progression, and plan adaptation.

---

## Stack

- Node.js + TypeScript, Express.js v5
- Supabase (PostgreSQL + Row-Level Security)
- OpenAI SDK (supports OpenAI and OpenRouter)
- Vitest + Supertest for testing

---

## Setup

```bash
pnpm install
```

Create `backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
OPENROUTER_API_KEY=sk-or-...
AI_PROVIDER=openrouter
```

```bash
pnpm dev      # development with hot reload
pnpm build    # compile to dist/
pnpm start    # run compiled build
```

---

## API endpoints

All endpoints except `/health` require `Authorization: Bearer <supabase-jwt>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/goals` | Create a goal and generate an AI plan |
| `GET` | `/goals` | List the user's goals |
| `POST` | `/tasks/generate` | Generate today's tasks for a goal |
| `POST` | `/tasks/update` | Mark a task done or skipped |
| `GET` | `/tasks?goal_id=...` | Fetch today's tasks |
| `POST` | `/adapt` | Rewrite pending tasks based on completion metrics |

---

## Testing

```bash
pnpm test          # run once
pnpm test:watch    # watch mode
```

Tests use an in-memory DB mock and stubbed AI — no real network calls.
