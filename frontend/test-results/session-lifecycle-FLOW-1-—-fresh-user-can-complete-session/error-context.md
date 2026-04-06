# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-lifecycle.spec.ts >> FLOW 1 — fresh user can complete session
- Location: e2e/session-lifecycle.spec.ts:73:5

# Error details

```
Error: Missing required env var: E2E_EMAIL
```

# Test source

```ts
  1   | import { test, expect, Page } from "@playwright/test";
  2   | 
  3   | function requireEnv(name: string) {
  4   |   const value = process.env[name];
  5   |   if (!value) {
> 6   |     throw new Error(`Missing required env var: ${name}`);
      |           ^ Error: Missing required env var: E2E_EMAIL
  7   |   }
  8   |   return value;
  9   | }
  10  | 
  11  | async function login(page: Page) {
  12  |   const email = requireEnv("E2E_EMAIL");
  13  |   const password = requireEnv("E2E_PASSWORD");
  14  | 
  15  |   await page.goto("/");
  16  |   await page.getByPlaceholder("Email").fill(email);
  17  |   await page.getByPlaceholder("Password").fill(password);
  18  |   await page.getByRole("button", { name: "Login" }).click();
  19  | 
  20  |   await expect(page.getByText("AI Personal Coach").first()).toBeVisible();
  21  | }
  22  | 
  23  | async function openGoalCreation(page: Page) {
  24  |   const createGoal = page.getByTestId("new-goal-nav-button");
  25  |   if (await createGoal.isVisible()) {
  26  |     await createGoal.click();
  27  |     return;
  28  |   }
  29  | 
  30  |   await page.getByRole("button", { name: /Start a new goal/i }).first().click();
  31  | }
  32  | 
  33  | async function createGoalAndPlan(page: Page, suffix: string) {
  34  |   await openGoalCreation(page);
  35  | 
  36  |   await page.getByTestId("goal-title-input").fill(`E2E Goal ${suffix}`);
  37  |   await page.getByTestId("goal-description-input").fill("Validate session lifecycle behaviors");
  38  |   await page.getByTestId("generate-plan-button").click();
  39  | 
  40  |   await expect(page.getByText("Build my roadmap")).toBeVisible({ timeout: 30_000 });
  41  | }
  42  | 
  43  | async function startToday(page: Page) {
  44  |   await page.getByTestId("plan-generate-session-button").click();
  45  | }
  46  | 
  47  | async function completeVisibleTasks(page: Page) {
  48  |   for (let i = 0; i < 5; i += 1) {
  49  |     const taskCards = page.locator("[data-testid^='task-card-']");
  50  |     const count = await taskCards.count();
  51  |     if (count === 0) break;
  52  | 
  53  |     let progressed = false;
  54  |     for (let idx = 0; idx < count; idx += 1) {
  55  |       const card = taskCards.nth(idx);
  56  |       await card.click();
  57  |       const doneButton = card.locator("[data-testid^='task-done-']");
  58  |       if (await doneButton.isVisible()) {
  59  |         await doneButton.click();
  60  |         progressed = true;
  61  |         await page.waitForTimeout(150);
  62  |       }
  63  |     }
  64  | 
  65  |     if (!progressed) break;
  66  |   }
  67  | }
  68  | 
  69  | async function sessionId(page: Page) {
  70  |   return await page.evaluate(() => (window as any).__SESSION_ID__ ?? null);
  71  | }
  72  | 
  73  | test("FLOW 1 — fresh user can complete session", async ({ page }) => {
  74  |   await login(page);
  75  |   await createGoalAndPlan(page, `fresh-${Date.now()}`);
  76  |   await startToday(page);
  77  | 
  78  |   await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  79  |   await completeVisibleTasks(page);
  80  | 
  81  |   await expect(page.getByTestId("session-completed-screen")).toBeVisible({ timeout: 30_000 });
  82  | });
  83  | 
  84  | test("FLOW 2 — session reuse across reload", async ({ page }) => {
  85  |   await login(page);
  86  |   await createGoalAndPlan(page, `reuse-${Date.now()}`);
  87  |   await startToday(page);
  88  | 
  89  |   await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  90  |   const firstSessionId = await sessionId(page);
  91  |   expect(firstSessionId).toBeTruthy();
  92  | 
  93  |   await page.reload();
  94  |   await page.waitForLoadState("networkidle");
  95  | 
  96  |   const secondSessionId = await sessionId(page);
  97  |   expect(secondSessionId).toBe(firstSessionId);
  98  | });
  99  | 
  100 | test("FLOW 3 — step progression increments index", async ({ page }) => {
  101 |   await login(page);
  102 |   await createGoalAndPlan(page, `step-${Date.now()}`);
  103 |   await startToday(page);
  104 | 
  105 |   await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  106 |   await completeVisibleTasks(page);
```