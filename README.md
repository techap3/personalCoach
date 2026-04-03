# AI Personal Coach

An AI-powered coaching app that turns long-term goals into structured, adaptive daily tasks. Tell it your goal, get a personalized multi-step plan, and work through AI-generated daily tasks that adjust to your pace.

---

## How it works

1. Set a goal
2. AI generates a multi-step plan
3. Each day, get 2–3 AI-generated tasks for your current step
4. Mark tasks done or skip them
5. Complete a step → next one auto-activates
6. Falling behind or breezing through? Hit **Adapt** — AI rewrites your tasks to match your pace

---

## Tech stack

| | |
|---|---|
| Frontend | Next.js, React, Tailwind CSS |
| Backend | Express.js, TypeScript, Node.js |
| Database / Auth | Supabase |
| AI | OpenAI API / OpenRouter |

---

## Getting started

### Requirements

- Node.js 18+
- pnpm
- A [Supabase](https://supabase.com) project
- An OpenAI or [OpenRouter](https://openrouter.ai) API key

### Install

```bash
git clone <repo-url>
cd ai-personal-coach

cd backend && pnpm install
cd ../frontend && pnpm install
```

### Configure

**`backend/.env`**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
OPENROUTER_API_KEY=sk-or-...
AI_PROVIDER=openrouter
```

**`frontend/.env.local`**
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

### Run

```bash
# Terminal 1
cd backend && pnpm dev

# Terminal 2
cd frontend && pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).
