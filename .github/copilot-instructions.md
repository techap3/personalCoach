# Copilot Cloud Agent Instructions — AI Personal Coach

## Repository Overview

This is a **pnpm monorepo** called `ai-personal-coach`. It is an AI-powered coaching app that turns long-term goals into structured, adaptive daily tasks. Users set a goal, receive an AI-generated multi-step plan, get 2–5 daily tasks per step, and can trigger an adaptive rewrite when they're off pace.

**Tech Stack:**
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS v4 — in `apps/frontend/`
- **Backend:** Express.js v5, TypeScript, Node.js ≥20 — in `apps/backend/`
- **Database / Auth:** Supabase (PostgreSQL + Row-Level Security)
- **AI:** OpenAI SDK — supports both OpenAI and OpenRouter; configured via `AI_PROVIDER` env var
- **Shared packages:** `packages/types`, `packages/constants`, `packages/api-contracts`
- **E2E tests:** Playwright in `e2e/`

---

## Monorepo Structure

```
/
├── apps/
│   ├── backend/          # Express.js REST API
│   │   ├── src/
│   │   │   ├── index.ts            # App entrypoint, runs migrations on startup
│   │   │   ├── logger.ts           # Pino logger (structured JSON)
│   │   │   ├── db/supabase.ts      # Supabase client factory (per-request, JWT-scoped)
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts         # JWT decode middleware; attaches req.user, req.token
│   │   │   │   └── trace.ts        # Attaches req.log (pino child) + x-trace-id header
│   │   │   ├── routes/
│   │   │   │   ├── goals.ts        # POST /goals, GET /goals
│   │   │   │   ├── tasks.ts        # POST /tasks/generate, POST /tasks/update, GET /tasks
│   │   │   │   └── adapt.ts        # POST /adapt
│   │   │   ├── services/
│   │   │   │   ├── ai/             # All AI interactions (plan, tasks, adaptation)
│   │   │   │   ├── memory/         # userMemory.ts — user preference upsert + retrieval
│   │   │   │   ├── progressionEngine.ts  # Advances plan steps when all tasks resolved
│   │   │   │   ├── metrics.ts      # Task completion metrics
│   │   │   │   ├── difficultyService.ts
│   │   │   │   ├── sessionSummary.ts
│   │   │   │   └── utils/normalization.ts
│   │   │   └── scripts/
│   │   │       ├── migrationRunner.ts    # Runs SQL migrations in filename order
│   │   │       └── runMigrations.ts      # CLI entry for `pnpm migrate`
│   │   ├── db/migrations/          # SQL migration files (executed in filename order)
│   │   └── tests/                  # Vitest unit tests (no real network calls)
│   └── frontend/
│       ├── src/app/
│       │   ├── page.tsx            # Main SPA page (goal/plan/task state management)
│       │   ├── sessionUi.ts        # Session state helpers (pure logic)
│       │   ├── components/         # React components (Login, GoalForm, PlanView, TasksView, DailySummary)
│       │   └── lib/supabase.ts     # Browser Supabase client
│       └── src/types/plan.ts       # Frontend plan type
├── packages/
│   ├── types/       # Shared TypeScript types (SessionType, TaskType, etc.)
│   ├── constants/   # Shared constants (SESSION_TYPE, SESSION_STATUS, DEFAULT_SESSION_TYPE)
│   └── api-contracts/
├── e2e/             # Playwright end-to-end tests
└── package.json     # Root workspace scripts
```

---

## How to Build, Test, and Lint

### Install dependencies (run from repo root)
```bash
pnpm install
```

### Backend
```bash
cd apps/backend
pnpm dev          # hot-reload dev server on :3001 (ts-node-dev)
pnpm build        # tsc → dist/
pnpm start        # run compiled build
pnpm test         # vitest run (unit tests, no network)
pnpm test:watch   # vitest watch mode
pnpm migrate      # execute pending SQL migrations
```

### Frontend
```bash
cd apps/frontend
pnpm dev          # Next.js dev server on :3000
pnpm build        # next build (production)
pnpm lint         # ESLint
pnpm test         # vitest run (unit tests)
```

### E2E
```bash
cd e2e
pnpm test         # Playwright tests (requires running backend + frontend)
```

### Root shortcuts
```bash
pnpm dev                # runs both backend and frontend concurrently
pnpm dev:frontend       # frontend only
pnpm dev:backend        # backend only
pnpm build              # frontend production build
pnpm test:e2e           # e2e tests
```

---

## Environment Variables

### Backend (`apps/backend/.env`)
```env
SUPABASE_URL=https://your-project.supabase.co            # Supabase project URL; not sufficient for migrations
SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
DATABASE_URL=postgresql://postgres:password@db.host:5432/postgres?sslmode=require
SUPABASE_DB_URL=postgresql://postgres:password@db.host:5432/postgres?sslmode=require  # alternative to DATABASE_URL for migrations
OPENROUTER_API_KEY=sk-or-...
AI_PROVIDER=openrouter          # or "openai"
OPENAI_API_KEY=sk-...           # only if AI_PROVIDER=openai
LOG_LEVEL=info                  # pino log level
PORT=3001
```

### Frontend (`apps/frontend/.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

---

## Key Architecture Patterns

### Authentication and Supabase Client
- Main app backend endpoints (for example, goals/tasks/adapt routes) require `Authorization: Bearer <supabase-jwt>`. `GET /health` and `/test/*` are unauthenticated health/dev-only diagnostic routes.
- `authMiddleware` (`src/middleware/auth.ts`) decodes the JWT (without verification — Supabase RLS handles enforcement) and attaches `req.user.id`, `req.user.email`, and `req.token`.
- **For user-scoped requests, never call `getSupabaseClient()` without the user's JWT token.** Always pass `req.token!` when the route is authenticated via `authMiddleware`.
- The Supabase client is created per-request, scoped to the user's JWT, so all DB queries automatically respect Row-Level Security (RLS).
- **Do not use `SECURITY DEFINER` SQL functions** unless ownership is enforced and row_security is forced. Prefer `security invoker`.

### Supabase Error Handling
- Supabase queries return `{ data, error }` and do **not** throw by default.
- The codebase typically checks `error` explicitly: `if (error) return res.status(500).json(error)` or `if (error) throw error`.
- Do **not** wrap Supabase calls in `try/catch` expecting them to throw — check the `error` property instead.
- When zero rows is an acceptable result, prefer `.maybeSingle()` because it returns `data: null` and `error: null` when no row is found. Use `.single()` only when exactly one row is required, since it returns a non-null `error` when 0 or more than 1 rows are returned.

### Date Handling — CRITICAL
- **Never** use `new Date().toISOString().split('T')[0]` for local date strings. This returns UTC date, which is wrong for users in positive-offset timezones.
- **Always** use the local-date helper pattern:
  ```typescript
  const getLocalDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  ```
- This pattern is used in `apps/backend/src/routes/tasks.ts` and `apps/backend/src/routes/adapt.ts`.
- For frontend code such as `DailySummary.tsx`, prefer formatting local date components directly (year/month/day) rather than relying on `toISOString()`; if the current implementation still uses `new Date().toISOString().split('T')[0]`, treat that as technical debt to fix separately rather than as the recommended pattern.

### Logging
- Backend uses **pino** (`src/logger.ts`). Import `logger` and use structured logging: `logger.info({ event: "...", ...fields }, "message")`.
- `traceMiddleware` attaches a child logger to `req.log` with `traceId`, `method`, and `path`. Inside route handlers, prefer `req.log ?? logger` for request-scoped logging.
- Do **not** use `console.log` for new application code. (Note: some legacy debug `console.log` calls remain in `progressionEngine.ts` — leave them as-is unless fixing that file.)

### AI Services
- AI clients are created via `getAIClient()` in `src/services/ai/provider.ts`. It returns an `OpenAI` instance configured for either OpenRouter or OpenAI based on `AI_PROVIDER`.
- The default model is `meta-llama/llama-3-8b-instruct`.
- All prompts return **only valid JSON**. Parsers in `services/ai/parser.ts`, `adaptParser.ts`, etc. handle extraction and validation.
- AI calls use a retry loop (typically 2 attempts) with error logging on failure.

### Task Generation and Limits
- Tasks per session: minimum 3, maximum 5 (`MIN_TASKS`, `MAX_TASKS` in `taskLimits.ts`).
- Valid `task_type` values: `"action" | "learn" | "reflect" | "review"`.
- Task generation enforces type mix (at least 1 `action` and 1 `reflect` or `review`), deduplication, behavioral preferences, and difficulty targeting.
- Task title deduplication uses `normalizeTaskTitle` from `services/utils/normalization.ts`.

### Session Model
- Each day a user can have up to 2 sessions per goal: `"primary"` and `"bonus"` (`DAILY_SESSION_LIMIT = 2`).
- Session types: `"primary" | "bonus"` (`SessionType` from `packages/types`).
- Session statuses: `"active" | "completed" | "failed"`.
- `SESSION_TYPE`, `SESSION_STATUS`, and `DEFAULT_SESSION_TYPE` are exported from `packages/constants`.
- A stale active session (>30 seconds old, `STALE_ACTIVE_SESSION_MS`) will be treated as failed to prevent stuck state.
- Generation locking (`generation_locked` column on `task_sessions`) prevents duplicate task generation from concurrent requests.

### Plan / Progression
- A **goal** has one **plan**, which has multiple **plan_steps** (`step_index` 0-based, `status: "pending" | "active" | "completed"`).
- Only one step is `"active"` at a time. The first step starts as `"active"`.
- `progressionEngine.ts` checks if all tasks for the active step are resolved (done/skipped) and if so, marks the step `"completed"` and activates the next one.
- `tasks` rows have `plan_step_id` linking to `plan_steps.id` — this must never be null.

### Migrations
- SQL files in `apps/backend/db/migrations/` are executed in **filename order** (lexicographic).
- Migration runner tracks executed files in a `migrations` table.
- Migrations run automatically on server startup in non-test environments.
- In **production**, a failed migration blocks server startup. In dev, it warns and continues.
- Run new migrations manually: `pnpm migrate` (from `apps/backend/`).
- When writing new migrations, use `security invoker` (not `security definer`) for functions.

---

## API Endpoints

All endpoints except `/health` require `Authorization: Bearer <supabase-jwt>`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — no auth |
| `POST` | `/goals` | Create a goal and generate AI plan |
| `GET` | `/goals` | List the current user's goals |
| `POST` | `/tasks/generate` | Generate today's tasks for a goal (session-aware) |
| `POST` | `/tasks/update` | Mark a task `done` or `skipped` |
| `GET` | `/tasks?goal_id=...` | Fetch today's tasks |
| `POST` | `/adapt` | Rewrite pending tasks based on completion metrics |

---

## Database Schema (Key Tables)

| Table | Key Columns |
|-------|-------------|
| `goals` | `id`, `user_id`, `title`, `description` |
| `plans` | `id`, `goal_id`, `plan_json` |
| `plan_steps` | `id`, `plan_id`, `goal_id`, `step_index`, `title`, `description`, `difficulty`, `status` |
| `task_sessions` | `id`, `goal_id`, `plan_step_id`, `user_id`, `session_date`, `session_type`, `status`, `generation_locked`, `summary_json` |
| `tasks` | `id`, `goal_id`, `session_id`, `plan_step_id`, `title`, `description`, `difficulty`, `task_type`, `status`, `scheduled_date`, `completed_at`, `skipped_at` |
| `user_preferences` | `user_id`, `avg_completion_rate`, `skip_rate`, `preferred_difficulty`, `consistency_score`, `skip_pattern`, `last_active` |
| `migrations` | `id` (filename), `executed_at` |

---

## Testing Approach

### Backend unit tests (`apps/backend/tests/` and `src/tests/`)
- **Vitest** with no real network calls. All Supabase and AI interactions are mocked via `vi.mock`.
- Test files use an in-memory DB mock pattern. See `tests/flow.test.ts` for examples.
- Run: `pnpm test` from `apps/backend/`.

### Frontend unit tests (`apps/frontend/src/**/*.test.ts`)
- **Vitest** with `vite-tsconfig-paths` plugin.
- Run: `pnpm test` from `apps/frontend/`.

### E2E tests (`e2e/tests/`)
- **Playwright** (`session-lifecycle.spec.ts`).
- Requires a running backend and frontend.
- Run: `pnpm test` from `e2e/`.

---

## Common Pitfalls and Workarounds

1. **Express v5 breaking change:** Do **not** add `app.options("*", cors())` — this is broken in Express v5. The existing CORS setup at the top of `index.ts` is correct and handles OPTIONS preflight.

2. **Next.js 16 (App Router) differences:** This is Next.js 16 with React 19. APIs, conventions, and file structure may differ from older versions. Before making frontend changes, check `node_modules/next/dist/docs/` for current documentation.

3. **Supabase `.single()` vs `.maybeSingle()`:** Use `.maybeSingle()` when a row might not exist (returns `null`). `.single()` throws when no row is found.

4. **Task `plan_step_id` must never be null:** When creating tasks (including adapted ones), always carry `plan_step_id` forward from the original pending tasks. The route validates this and returns a 500 if any task is missing it.

5. **Session deduplication:** There is a unique constraint enforcing one session per goal per day per type. Do not attempt to create duplicate sessions — check existing sessions first.

6. **User preferences update debounce:** `updateUserPreferences` is debounced (2 seconds per user, `UPDATE_DEBOUNCE_MS`). Pass `{ force: true }` if you need an immediate update.

7. **TypeScript path aliases:** Frontend uses `@/` aliases (configured in `tsconfig.json`). Shared packages are imported as `@repo/types`, `@repo/constants`, etc. (workspace packages).

8. **Local date strings:** Always use the local-date constructor pattern (see "Date Handling" above). Do not use `new Date().toISOString().split('T')[0]`.
