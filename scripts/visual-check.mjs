import { chromium } from "playwright";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const results = [];
const baseUrl = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5173";
const testUsername = process.env.VISUAL_TEST_USERNAME ?? "codex_test";
const testPassword = process.env.VISUAL_TEST_PASSWORD ?? "TestPass2026";

async function login(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("用户名").fill(testUsername);
  await page.getByLabel("密码").fill(testPassword);
  await page.getByRole("button", { name: "登录", exact: true }).last().click();
  await page.waitForURL(`${baseUrl}/`);
  await page.getByRole("heading", { name: "今天准备练哪部分？" }).waitFor();
  await page.getByText("已练题目", { exact: true }).waitFor();
}

async function checkViewport(name, viewport, screenshot, route = "/") {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const status = response.status();
    const path = new URL(response.url()).pathname;
    if (status >= 400 && !(status === 401 && path === "/api/auth/me") && path !== "/favicon.ico") {
      errors.push(`${status} ${path}`);
    }
  });
  await login(page);
  if (route !== "/") {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
  }
  await page.screenshot({ path: screenshot, fullPage: true });
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.clientHeight,
    bodyHeight: document.body.scrollHeight
  }));
  results.push({ name, dimensions, errors });
  await context.close();
}

async function checkAdminInteraction(name, viewport, screenshot, interact) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const status = response.status();
    const path = new URL(response.url()).pathname;
    if (status >= 400 && !(status === 401 && path === "/api/auth/me") && path !== "/favicon.ico") errors.push(`${status} ${path}`);
  });
  await login(page);
  await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  await interact(page);
  await page.screenshot({ path: screenshot, fullPage: true });
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.clientHeight,
    bodyHeight: document.body.scrollHeight
  }));
  results.push({ name, dimensions, errors });
  await context.close();
}

async function checkQuizNavigator(name, viewport, screenshot) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const status = response.status();
    const path = new URL(response.url()).pathname;
    if (status >= 400 && !(status === 401 && path === "/api/auth/me") && path !== "/favicon.ico") errors.push(`${status} ${path}`);
  });
  await login(page);
  await page.goto(`${baseUrl}/quiz?scope=all&type=all&review=sequence`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /题库练习/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("heading", { name: "浏览题号" }).waitFor();
  await page.screenshot({ path: screenshot, fullPage: true });
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.clientHeight,
    bodyHeight: document.body.scrollHeight
  }));
  results.push({ name, dimensions, errors });
  await context.close();
}

await checkViewport("desktop-dashboard", { width: 1440, height: 900 }, "/private/tmp/acp-desktop.png");
await checkViewport("desktop-admin", { width: 1440, height: 900 }, "/private/tmp/acp-admin-desktop.png", "/admin");
await checkViewport("mobile-dashboard", { width: 390, height: 844 }, "/private/tmp/acp-mobile.png");
await checkViewport("mobile-admin", { width: 390, height: 844 }, "/private/tmp/acp-admin-mobile.png", "/admin");
await checkViewport("mobile-profile", { width: 390, height: 844 }, "/private/tmp/acp-profile-mobile.png", "/profile");
await checkViewport("mobile-quiz", { width: 390, height: 844 }, "/private/tmp/acp-mobile-quiz.png", "/quiz?scope=all&type=all&review=sequence&limit=10");
await checkAdminInteraction("mobile-admin-users", { width: 390, height: 844 }, "/private/tmp/acp-admin-users-mobile.png", async (page) => {
  await page.getByRole("button", { name: "用户管理" }).click();
  await page.getByText(/注册用户 \d+ 人/).waitFor();
});
await checkAdminInteraction("desktop-question-editor", { width: 1440, height: 900 }, "/private/tmp/acp-editor-desktop.png", async (page) => {
  await page.getByTitle("编辑题目").first().click();
  await page.getByRole("dialog").waitFor();
});
await checkQuizNavigator("desktop-quiz-navigator", { width: 1440, height: 900 }, "/private/tmp/acp-quiz-navigator-desktop.png");
await checkQuizNavigator("mobile-quiz-navigator", { width: 390, height: 844 }, "/private/tmp/acp-quiz-navigator-mobile.png");

await browser.close();
console.log(JSON.stringify(results, null, 2));
if (results.some((item) => item.errors.length || item.dimensions.scrollWidth > item.dimensions.width)) process.exitCode = 1;
