import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("tmlab.language", "en"));
});
test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual([]);
});
async function ready(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.locator("#groups .box").first()).toBeVisible();
  await expect(page.locator("#clock")).not.toHaveText("00:00.0");
}
async function pause(page: Page) {
  if ((await page.locator("#pause").textContent()) === "Ⅱ Pause")
    await page.locator("#pause").click();
  await expect(page.locator("#pause")).toHaveText("▶ Resume");
}
async function json(page: Page) {
  await page.locator("#edit-config").click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  return page.locator("#config-editor");
}
test("live settings, drafts, selection and localization preserve virtual time", async ({
  page,
}) => {
  await ready(page);
  const input = page.locator("#workers");
  await input.fill("37");
  await page.waitForTimeout(500);
  await expect(input).toHaveValue("37");
  await expect(input).toBeFocused();
  await input.blur();
  await expect(input).toHaveValue("37");
  await pause(page);
  const time = await page.locator("#clock").textContent();
  const area = await json(page);
  let config = JSON.parse(await area.inputValue());
  expect(config.overrides["db-1"].workers).toBe(37);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#language").selectOption("ru");
  await expect(page.locator("h1")).toHaveText(
    "Как система ведёт себя под нагрузкой",
  );
  await expect(page.locator("#clock")).toHaveText(time!);
  await expect(page.locator("#workers")).toHaveValue("37");
  await page.locator("#language").selectOption("en");
  await page.locator('[data-scope="group"]').click();
  await input.fill("22");
  await input.blur();
  await expect(input).toHaveValue("22");
  config = JSON.parse(await (await json(page)).inputValue());
  expect(config.groups.find((g: { id: string }) => g.id === "db").workers).toBe(
    22,
  );
  expect(config.overrides["db-1"]?.workers).toBeUndefined();
  await expect(page.locator("#clock")).toHaveText(time!);
});
test("manual request, trace focus, invalid import and structural restart", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#request-mode").selectOption("single");
  await page.locator("#reset").click();
  await expect(page.locator("#clock")).toHaveText("00:00.0");
  await page.locator("#send-request").click();
  await expect(page.locator("#send-request")).toBeEnabled();
  await expect(page.locator("#trace-events tbody tr").first()).toBeVisible();
  const chip = page.locator("#trace-list button").first();
  await chip.click();
  await chip.focus();
  await page.waitForTimeout(350);
  await expect(chip).toBeFocused();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const before = await page.locator("#clock").textContent();
  const area = await json(page);
  const config = JSON.parse(await area.inputValue());
  config.groups[0].edges = [];
  await area.fill(JSON.stringify(config));
  await page.locator("#apply-config").click();
  await expect(page.locator("#config-error")).toContainText("unknown field");
  await expect(page.locator("#clock")).toHaveText(before!);
  delete config.groups[0].edges;
  config.groups[0].name = "<user name>";
  await area.fill(JSON.stringify(config));
  await page.locator("#apply-config").click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  await expect(page.locator("#clock")).toHaveText("00:00.0");
  await expect(page.locator('[data-group="lb"] .group-title')).toContainText(
    "<user name>",
  );
  await expect(page.locator("#trace-list button")).toHaveCount(0);
});
test("preset deep links, back navigation and all presets", async ({ page }) => {
  await ready(page, "/#template=numa");
  await expect(page.locator('[data-scenario="numa"]')).toHaveClass("active");
  for (const id of [
    "normal",
    "slow",
    "fanout",
    "hang",
    "autoscale",
    "az",
    "composition",
  ]) {
    await page.locator(`[data-scenario="${id}"]`).click();
    await expect(page.locator(`[data-scenario="${id}"]`)).toHaveClass("active");
    await expect(page.locator("#groups .box").first()).toBeVisible();
  }
  await page.goBack();
  await expect(page.locator('[data-scenario="az"]')).toHaveClass("active");
  await page.reload();
  await expect(page.locator('[data-scenario="az"]')).toHaveClass("active");
});
test("standalone loads from file without external requests", async ({
  page,
}) => {
  const network: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await ready(page, "file://" + resolve("dist/standalone.html"));
  await page.locator("#request-mode").selectOption("single");
  await page.locator("#send-request").click();
  await expect(page.locator("#trace-events tbody tr").first()).toBeVisible();
  await expect(page.locator("#send-request")).toBeEnabled();
  expect(network).toEqual([]);
  await page.screenshot({ path: "/tmp/timeout-lab-react.png", fullPage: true });
});
test("rendering remains responsive at 64 instances", async ({ page }) => {
  await ready(page);
  await pause(page);
  const area = await json(page);
  const config = JSON.parse(await area.inputValue());
  config.groups = [
    ...config.groups,
    { ...structuredClone(config.groups[2]), id: "extra" },
  ];
  config.groups.forEach((g: { count: number }) => (g.count = 16));
  await area.fill(JSON.stringify(config));
  await page.locator("#apply-config").click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  for (const toggle of await page.locator(".group-toggle").all())
    await toggle.click();
  await expect(page.locator(".box")).toHaveCount(64);
  await page.locator("#pause").click();
  const frames = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const delays: number[] = [];
        let last = performance.now();
        const start = last;
        function frame(now: number) {
          delays.push(now - last);
          last = now;
          if (now - start < 2000) requestAnimationFrame(frame);
          else resolve(delays);
        }
        requestAnimationFrame(frame);
      }),
  );
  frames.sort((a, b) => a - b);
  console.log(
    "64 nodes frame p95:",
    frames[Math.floor(frames.length * 0.95)],
    "ms",
  );
  expect(frames[Math.floor(frames.length * 0.95)]).toBeLessThan(100);
});

test("resource overrides, form drafts, live programs and export retain the model", async ({
  page,
}) => {
  await ready(page);
  await pause(page);
  const before = await page.locator("#clock").textContent();
  await page
    .locator("#resource-tabs")
    .getByRole("button", { name: "Disk", exact: true })
    .click();
  await page.locator("#service").fill("0");
  await page.locator("#service").blur();
  let area = await json(page);
  const config = JSON.parse(await area.inputValue());
  expect(config.overrides["db-1/~storage"].service).toBe(0);
  config.groups[2].stages[0].calls[0].timeout = 0;
  config.groups[2].stages[0].calls[0].calls = 2;
  await area.fill(JSON.stringify(config));
  await page
    .getByRole("button", { name: "Apply without reset", exact: true })
    .click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  await expect(page.locator("#clock")).toHaveText(before!);
  await page.locator("#edit-config").click();
  await page.locator(".schema-editor > details > summary").click();
  const rps = page
    .locator(".schema-editor")
    .getByRole("spinbutton", { name: "rps", exact: true });
  await rps.fill("");
  await page.waitForTimeout(250);
  await expect(rps).toBeFocused();
  await rps.fill("123");
  await rps.blur();
  await page
    .getByRole("button", { name: "Apply without reset", exact: true })
    .click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  await expect(page.locator("#rps")).toHaveValue("123");
  const downloading = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("boxes-model.json");
  const stream = await download.createReadStream();
  const parts: Buffer[] = [];
  for await (const part of stream!) parts.push(part);
  const exported = JSON.parse(Buffer.concat(parts).toString());
  expect(exported.rps).toBe(123);
  expect(exported.groups[2].stages[0].calls[0].calls).toBe(2);
  expect(exported.overrides["db-1/~storage"].service).toBe(0);
});

test("model names remain literal when switching language", async ({ page }) => {
  await ready(page);
  await pause(page);
  const before = await page.locator("#clock").textContent();
  const area = await json(page);
  const model = JSON.parse(await area.inputValue());
  model.groups[2].name = "Database";
  delete model.groups[2].i18n;
  await area.fill(JSON.stringify(model));
  await page
    .getByRole("button", { name: "Apply without reset", exact: true })
    .click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  await page.locator("#language").selectOption("ru");
  await expect(page.locator(".right-column h2").first()).toHaveText("Database");
  await expect(page.locator("#clock")).toHaveText(before!);
});
