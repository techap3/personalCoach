# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-lifecycle.spec.ts >> FLOW 4 — no auto generation after completion without CTA
- Location: e2e/session-lifecycle.spec.ts:232:5

# Error details

```
Error: Login failed: Login failed
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e5]:
    - heading "AI Personal Coach" [level=1] [ref=e6]
    - textbox "Email" [ref=e7]: test@example.com
    - textbox "Password" [ref=e8]: "123456"
    - button "Login" [active] [ref=e9]
  - button "Open Next.js Dev Tools" [ref=e15] [cursor=pointer]:
    - img [ref=e16]
  - alert [ref=e19]
```

# Test source

```ts
  1   | import { test, expect, Page } from "@playwright/test";
  2   | import fs from "fs";
  3   | import path from "path";
  4   | 
  5   | declare global {
  6   |   interface Window {
  7   |     __SESSION_ID__?: string | null;
  8   |   }
  9   | }
  10  | 
  11  | const parsedEnvCache: Record<string, string> = {};
  12  | let envParsed = false;
  13  | 
  14  | function parseEnvFiles() {
  15  |   if (envParsed) return;
  16  |   envParsed = true;
  17  | 
  18  |   const envFiles = [".env.local", ".env"];
  19  |   const roots = [
  20  |     process.cwd(),
  21  |     path.join(process.cwd(), "frontend"),
  22  |     path.resolve(process.cwd(), ".."),
  23  |     path.resolve(process.cwd(), "..", "frontend"),
  24  |   ];
  25  | 
  26  |   const seen = new Set<string>();
  27  |   for (const root of roots) {
  28  |     for (const fileName of envFiles) {
  29  |       const fullPath = path.join(root, fileName);
  30  |       if (seen.has(fullPath) || !fs.existsSync(fullPath)) continue;
  31  |       seen.add(fullPath);
  32  | 
  33  |       const content = fs.readFileSync(fullPath, "utf8");
  34  |       for (const rawLine of content.split(/\r?\n/)) {
  35  |         const line = rawLine.trim();
  36  |         if (!line || line.startsWith("#")) continue;
  37  | 
  38  |         const eqIndex = line.indexOf("=");
  39  |         if (eqIndex <= 0) continue;
  40  | 
  41  |         const key = line.slice(0, eqIndex).trim();
  42  |         let value = line.slice(eqIndex + 1).trim();
  43  |         if (
  44  |           (value.startsWith('"') && value.endsWith('"')) ||
  45  |           (value.startsWith("'") && value.endsWith("'"))
  46  |         ) {
  47  |           value = value.slice(1, -1);
  48  |         }
  49  | 
  50  |         if (!(key in parsedEnvCache)) {
  51  |           parsedEnvCache[key] = value;
  52  |         }
  53  |       }
  54  |     }
  55  |   }
  56  | }
  57  | 
  58  | function requireEnv(name: string) {
  59  |   const value = process.env[name];
  60  |   if (value) return value;
  61  | 
  62  |   parseEnvFiles();
  63  |   const fallbackValue = parsedEnvCache[name];
  64  |   if (fallbackValue) return fallbackValue;
  65  | 
  66  |   if (!value) {
  67  |     throw new Error(`Missing required env var: ${name}`);
  68  |   }
  69  | 
  70  |   return value;
  71  | }
  72  | 
  73  | async function login(page: Page) {
  74  |   const email = requireEnv("E2E_EMAIL");
  75  |   const password = requireEnv("E2E_PASSWORD");
  76  | 
  77  |   let loginDialogMessage: string | null = null;
  78  |   page.on("dialog", async (dialog) => {
  79  |     loginDialogMessage = dialog.message();
  80  |     await dialog.accept();
  81  |   });
  82  | 
  83  |   await page.goto("/");
  84  |   await page.getByPlaceholder("Email").fill(email);
  85  |   await page.getByPlaceholder("Password").fill(password);
  86  |   await page.getByRole("button", { name: "Login" }).click();
  87  | 
  88  |   const successLocators = [
  89  |     page.getByTestId("new-goal-nav-button"),
  90  |     page.getByRole("button", { name: /Start a new goal/i }).first(),
  91  |     page.getByRole("button", { name: "Home" }),
  92  |     page.getByTestId("goal-title-input"),
  93  |   ];
  94  | 
  95  |   const startedAt = Date.now();
  96  |   while (Date.now() - startedAt < 30_000) {
  97  |     if (loginDialogMessage) {
> 98  |       throw new Error(`Login failed: ${loginDialogMessage}`);
      |             ^ Error: Login failed: Login failed
  99  |     }
  100 | 
  101 |     for (const locator of successLocators) {
  102 |       if (await locator.isVisible().catch(() => false)) {
  103 |         return;
  104 |       }
  105 |     }
  106 | 
  107 |     await page.waitForTimeout(200);
  108 |   }
  109 | 
  110 |   throw new Error("Login did not reach an authenticated view within 30s");
  111 | }
  112 | 
  113 | async function openGoalCreation(page: Page) {
  114 |   const createGoal = page.getByTestId("new-goal-nav-button");
  115 |   const startGoal = page.getByRole("button", { name: /Start a new goal/i }).first();
  116 |   const goalTitleInput = page.getByTestId("goal-title-input");
  117 |   const homeButton = page.getByRole("button", { name: "Home" });
  118 | 
  119 |   if (await goalTitleInput.isVisible().catch(() => false)) {
  120 |     return;
  121 |   }
  122 | 
  123 |   if (
  124 |     !(await createGoal.isVisible().catch(() => false)) &&
  125 |     !(await startGoal.isVisible().catch(() => false)) &&
  126 |     (await homeButton.isVisible().catch(() => false))
  127 |   ) {
  128 |     await homeButton.click();
  129 |   }
  130 | 
  131 |   await Promise.race([
  132 |     createGoal.waitFor({ state: "visible", timeout: 30_000 }),
  133 |     startGoal.waitFor({ state: "visible", timeout: 30_000 }),
  134 |     goalTitleInput.waitFor({ state: "visible", timeout: 30_000 }),
  135 |   ]);
  136 | 
  137 |   if (await goalTitleInput.isVisible().catch(() => false)) {
  138 |     return;
  139 |   }
  140 | 
  141 |   if (await createGoal.isVisible()) {
  142 |     await createGoal.click();
  143 |     return;
  144 |   }
  145 | 
  146 |   await startGoal.click();
  147 | }
  148 | 
  149 | async function createGoalAndPlan(page: Page, suffix: string) {
  150 |   await openGoalCreation(page);
  151 | 
  152 |   await page.getByTestId("goal-title-input").fill(`E2E Goal ${suffix}`);
  153 |   await page.getByTestId("goal-description-input").fill("Validate session lifecycle behaviors");
  154 |   await page.getByTestId("generate-plan-button").click();
  155 | 
  156 |   await expect(page.getByText("Build my roadmap")).toBeVisible({ timeout: 30_000 });
  157 | }
  158 | 
  159 | async function startToday(page: Page) {
  160 |   await page.getByTestId("plan-generate-session-button").click();
  161 | }
  162 | 
  163 | async function completeVisibleTasks(page: Page) {
  164 |   for (let i = 0; i < 5; i += 1) {
  165 |     const taskCards = page.locator("[data-testid^='task-card-']");
  166 |     const count = await taskCards.count();
  167 |     if (count === 0) break;
  168 | 
  169 |     let progressed = false;
  170 |     for (let idx = 0; idx < count; idx += 1) {
  171 |       const card = taskCards.nth(idx);
  172 |       await card.click();
  173 |       const doneButton = card.locator("[data-testid^='task-done-']");
  174 |       if (await doneButton.isVisible()) {
  175 |         await doneButton.click();
  176 |         progressed = true;
  177 |         await page.waitForTimeout(150);
  178 |       }
  179 |     }
  180 | 
  181 |     if (!progressed) break;
  182 |   }
  183 | }
  184 | 
  185 | async function sessionId(page: Page) {
  186 |   return await page.evaluate(() => window.__SESSION_ID__ ?? null);
  187 | }
  188 | 
  189 | test("FLOW 1 — fresh user can complete session", async ({ page }) => {
  190 |   await login(page);
  191 |   await createGoalAndPlan(page, `fresh-${Date.now()}`);
  192 |   await startToday(page);
  193 | 
  194 |   await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  195 |   await completeVisibleTasks(page);
  196 | 
  197 |   await expect(page.getByTestId("session-completed-screen")).toBeVisible({ timeout: 30_000 });
  198 | });
```