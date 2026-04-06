import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

declare global {
  interface Window {
    __SESSION_ID__?: string | null;
  }
}

const parsedEnvCache: Record<string, string> = {};
let envParsed = false;

function parseEnvFiles() {
  if (envParsed) return;
  envParsed = true;

  const envFiles = [".env.local", ".env"];
  const roots = [
    process.cwd(),
    path.join(process.cwd(), "frontend"),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", "frontend"),
  ];

  const seen = new Set<string>();
  for (const root of roots) {
    for (const fileName of envFiles) {
      const fullPath = path.join(root, fileName);
      if (seen.has(fullPath) || !fs.existsSync(fullPath)) continue;
      seen.add(fullPath);

      const content = fs.readFileSync(fullPath, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const eqIndex = line.indexOf("=");
        if (eqIndex <= 0) continue;

        const key = line.slice(0, eqIndex).trim();
        let value = line.slice(eqIndex + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        if (!(key in parsedEnvCache)) {
          parsedEnvCache[key] = value;
        }
      }
    }
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (value) return value;

  parseEnvFiles();
  const fallbackValue = parsedEnvCache[name];
  if (fallbackValue) return fallbackValue;

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

async function login(page: Page) {
  const email = requireEnv("E2E_EMAIL");
  const password = requireEnv("E2E_PASSWORD");

  let loginDialogMessage: string | null = null;
  page.on("dialog", async (dialog) => {
    loginDialogMessage = dialog.message();
    await dialog.accept();
  });

  await page.goto("/");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();

  const successLocators = [
    page.getByTestId("new-goal-nav-button"),
    page.getByRole("button", { name: /Start a new goal/i }).first(),
    page.getByRole("button", { name: "Home" }),
    page.getByTestId("goal-title-input"),
  ];

  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (loginDialogMessage) {
      throw new Error(`Login failed: ${loginDialogMessage}`);
    }

    for (const locator of successLocators) {
      if (await locator.isVisible().catch(() => false)) {
        return;
      }
    }

    await page.waitForTimeout(200);
  }

  throw new Error("Login did not reach an authenticated view within 30s");
}

async function openGoalCreation(page: Page) {
  const createGoal = page.getByTestId("new-goal-nav-button");
  const startGoal = page.getByRole("button", { name: /Start a new goal/i }).first();
  const goalTitleInput = page.getByTestId("goal-title-input");
  const homeButton = page.getByRole("button", { name: "Home" });

  if (await goalTitleInput.isVisible().catch(() => false)) {
    return;
  }

  if (
    !(await createGoal.isVisible().catch(() => false)) &&
    !(await startGoal.isVisible().catch(() => false)) &&
    (await homeButton.isVisible().catch(() => false))
  ) {
    await homeButton.click();
  }

  await Promise.race([
    createGoal.waitFor({ state: "visible", timeout: 30_000 }),
    startGoal.waitFor({ state: "visible", timeout: 30_000 }),
    goalTitleInput.waitFor({ state: "visible", timeout: 30_000 }),
  ]);

  if (await goalTitleInput.isVisible().catch(() => false)) {
    return;
  }

  if (await createGoal.isVisible()) {
    await createGoal.click();
    return;
  }

  await startGoal.click();
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
