import { test, expect, Page } from "@playwright/test";

declare global {
  interface Window {
    __SESSION_ID__?: string | null;
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function login(page: Page) {
  const email = requireEnv("E2E_EMAIL");
  const password = requireEnv("E2E_PASSWORD");

  await page.goto("/");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByText("AI Personal Coach").first()).toBeVisible();
}

async function openGoalCreation(page: Page) {
  const createGoal = page.getByTestId("new-goal-nav-button");
  if (await createGoal.isVisible()) {
    await createGoal.click();
    return;
  }

  await page.getByRole("button", { name: /Start a new goal/i }).first().click();
}

async function createGoalAndPlan(page: Page, suffix: string) {
  await openGoalCreation(page);

  await page.getByTestId("goal-title-input").fill(`E2E Goal ${suffix}`);
  await page.getByTestId("goal-description-input").fill("Validate session lifecycle behaviors");
  await page.getByTestId("generate-plan-button").click();

  await expect(page.getByText("Build my roadmap")).toBeVisible({ timeout: 30_000 });
}

async function startToday(page: Page) {
  await page.getByTestId("plan-generate-session-button").click();
}

async function completeVisibleTasks(page: Page) {
  for (let i = 0; i < 5; i += 1) {
    const taskCards = page.locator("[data-testid^='task-card-']");
    const count = await taskCards.count();
    if (count === 0) break;

    let progressed = false;
    for (let idx = 0; idx < count; idx += 1) {
      const card = taskCards.nth(idx);
      await card.click();
      const doneButton = card.locator("[data-testid^='task-done-']");
      if (await doneButton.isVisible()) {
        await doneButton.click();
        progressed = true;
        await page.waitForTimeout(150);
      }
    }

    if (!progressed) break;
  }
}

async function sessionId(page: Page) {
  return await page.evaluate(() => window.__SESSION_ID__ ?? null);
}

test("FLOW 1 — fresh user can complete session", async ({ page }) => {
  await login(page);
  await createGoalAndPlan(page, `fresh-${Date.now()}`);
  await startToday(page);

  await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  await completeVisibleTasks(page);

  await expect(page.getByTestId("session-completed-screen")).toBeVisible({ timeout: 30_000 });
});

test("FLOW 2 — session reuse across reload", async ({ page }) => {
  await login(page);
  await createGoalAndPlan(page, `reuse-${Date.now()}`);
  await startToday(page);

  await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  const firstSessionId = await sessionId(page);
  expect(firstSessionId).toBeTruthy();

  await page.reload();
  await page.waitForLoadState("networkidle");

  const secondSessionId = await sessionId(page);
  expect(secondSessionId).toBe(firstSessionId);
});

test("FLOW 3 — step progression increments index", async ({ page }) => {
  await login(page);
  await createGoalAndPlan(page, `step-${Date.now()}`);
  await startToday(page);

  await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  await completeVisibleTasks(page);

  const before = await page.getByTestId("current-step-indicator").innerText();
  await page.getByRole("button", { name: /Do More Today|Continue to Next Step/i }).first().click();
  await expect(page.getByTestId("current-step-indicator")).toBeVisible({ timeout: 30_000 });
  const after = await page.getByTestId("current-step-indicator").innerText();

  expect(before).not.toEqual(after);
});

test("FLOW 4 — no auto generation after completion without CTA", async ({ page }) => {
  await login(page);
  await createGoalAndPlan(page, `no-auto-${Date.now()}`);
  await startToday(page);

  await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  await completeVisibleTasks(page);

  await expect(page.getByTestId("session-completed-screen")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  await expect(page.getByTestId("session-completed-screen")).toBeVisible();
  await expect(page.locator("[data-testid^='task-card-']")).toHaveCount(0);
});

test("FLOW 5 — concurrent Start Today converges without duplication", async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await login(pageA);
  await createGoalAndPlan(pageA, `concurrency-${Date.now()}`);

  await pageB.goto("/");
  await expect(pageB.getByText("Build my roadmap")).toBeVisible({ timeout: 30_000 });

  await Promise.all([
    pageA.getByTestId("plan-generate-session-button").click(),
    pageB.getByTestId("plan-generate-session-button").click(),
  ]);

  await expect(pageA.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });
  await expect(pageB.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: 30_000 });

  const [sessionA, sessionB] = await Promise.all([sessionId(pageA), sessionId(pageB)]);
  expect(sessionA).toBeTruthy();
  expect(sessionA).toBe(sessionB);

  const taskTitlesA = await pageA.locator("[data-testid^='task-card-'] h3").allTextContents();
  const uniqueTitles = new Set(taskTitlesA.map((title) => title.trim().toLowerCase()));
  expect(uniqueTitles.size).toBe(taskTitlesA.length);

  await context.close();
});
