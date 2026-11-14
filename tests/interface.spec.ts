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

test("cards select on the first pointer press across their surface and preserve scope", async ({
  page,
}) => {
  await ready(page);
  // Use physical coordinates: a missing hit target must not be hidden by retries.
  async function clickSurface(selector: string, edge = false, hold = false) {
    const target = page.locator(selector);
    await target.scrollIntoViewIfNeeded();
    const rect = (await target.boundingBox())!;
    await page.mouse.move(
      rect.x + (edge ? 3 : rect.width / 2),
      rect.y + (edge ? rect.height - 3 : rect.height / 2),
    );
    await page.mouse.down();
    if (hold) await page.waitForTimeout(350);
    await page.mouse.up();
  }
  await clickSurface('[data-node="api-1"] .worker-grid', false, true);
  await expect(page.locator("#selected-id")).toHaveText("api-1");
  await expect(
    page.locator('[data-node="api-1"] .node-select'),
  ).toHaveAttribute("aria-pressed", "true");
  await clickSurface('[data-node="api-2"] .box-stats');
  await expect(page.locator("#selected-id")).toHaveText("api-2");
  await clickSurface('[data-node="lb-1"]', true);
  await expect(page.locator("#selected-id")).toHaveText("lb-1");
  await page
    .locator('[data-node="db-1"] .resource-bar')
    .filter({ hasText: "Disk" })
    .click();
  await expect(page.locator("#selected-id")).toHaveText("db-1/~storage");
  await expect(
    page.locator('#resource-tabs button[aria-pressed="true"]'),
  ).toHaveText("Disk");
  await clickSurface('[data-node="api-3"] .worker-grid');
  await expect(
    page.locator('#resource-tabs button[aria-pressed="true"]'),
  ).toHaveText("Requests");
  await page.locator('[data-scope="group"]').click();
  await expect(page.locator('[data-scope="group"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-group="api"] .box.selected')).toHaveCount(4);
  await clickSurface('[data-node="api-4"] .box-stats');
  await expect(page.locator("#selected-id")).toHaveText("api");
  await page.locator('[data-scope="node"]').click();
  await expect(page.locator("#selected-id")).toHaveText("api-4");
  await expect(page.locator('[data-group="api"] .box.selected')).toHaveCount(1);
  await page.locator('[data-node="lb-1"] .node-select').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#selected-id")).toHaveText("lb-1");
  await page.locator('[data-group="api"] .group-toggle').click();
  await clickSurface('[data-group="api"] .group-summary > p');
  await expect(page.locator("#selected-id")).toHaveText("api");
  await expect(page.locator('[data-group="api"] .group-summary')).toHaveClass(
    /selected/,
  );
});

test("trace selection, call hierarchy and event units survive snapshots and localization", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#request-mode").selectOption("single");
  await page.locator("#reset").click();
  await expect(page.locator("#trace-list button")).toHaveCount(0);
  await page.locator("#send-request").click();
  await expect(page.locator("#trace-events tbody tr").first()).toBeVisible();
  await expect(page.locator("#send-request")).toBeEnabled();
  await expect(page.locator(".trace-chip.active")).toHaveAttribute(
    "data-trace",
    "1",
  );
  await expect(page.locator(".trace-chip.active")).not.toHaveClass(
    /error|pending/,
  );
  await expect(page.locator(".trace-summary .result")).toHaveText("success");
  await expect(page.locator(".trace-row.resource-row")).toHaveCount(5);
  const tree = await page.locator(".trace-row[data-span]").evaluateAll((rows) =>
    rows.map((row) => ({
      id: Number(row.getAttribute("data-span")),
      parent: Number(row.getAttribute("data-parent")),
      indent: Number.parseInt(
        (row.querySelector(".trace-label") as HTMLElement).style.paddingLeft,
      ),
    })),
  );
  const previous = new Map<number, number>([[0, -10]]);
  for (const row of tree) {
    expect(previous.has(row.parent)).toBe(true);
    expect(row.indent).toBe(previous.get(row.parent)! + 10);
    previous.set(row.id, row.indent);
  }
  await expect(page.locator(".trace-legend")).toContainText(
    "Network / connect",
  );
  await expect(page.locator("#trace-events")).toContainText("Budget: 3,000 ms");
  await expect(page.locator("#trace-events")).toContainText("Queue depth: 1");
  await expect(page.locator("#trace-events")).toContainText("Budget: 0 ms");
  await expect(page.locator("#trace-events")).toContainText(
    /Duration: [\d.]+ ms/,
  );
  await page
    .getByRole("button", { name: "Hide resources", exact: false })
    .click();
  await expect(page.locator(".trace-row.resource-row")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show resources", exact: false })
    .click();
  await expect(page.locator(".trace-row.resource-row")).toHaveCount(5);
  await page.locator("#send-request").click();
  await expect(page.locator(".trace-chip.active")).toHaveAttribute(
    "data-trace",
    "2",
  );
  await expect(page.locator("#send-request")).toBeEnabled();
  await expect(page.locator('[data-node="api-2"]')).toHaveClass(/trace-path/);
  const first = page.locator('[data-trace="1"]');
  await first.click();
  await first.focus();
  await page.waitForTimeout(350);
  await expect(first).toBeFocused();
  await expect(first).toHaveClass(/active/);
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-node="api-1"]')).toHaveClass(/trace-path/);
  await expect(page.locator('[data-node="api-2"]')).not.toHaveClass(
    /trace-path/,
  );
  const time = await page.locator("#clock").textContent();
  await page.locator("#language").selectOption("ru");
  await expect(first).toHaveClass(/active/);
  await expect(page.locator(".trace-summary .result")).toHaveText("успешно");
  await expect(page.locator("#trace-events")).toContainText("Бюджет:");
  await expect(page.locator(".trace-legend")).toContainText("Обработка");
  await expect(page.locator("#clock")).toHaveText(time!);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".trace-toolbar button")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("trace timing separates the user deadline from continuing box work", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#request-mode").selectOption("single");
  const area = await json(page);
  const config = JSON.parse(await area.inputValue());
  config.groups = [{ ...config.groups[0], service: 500, stages: [] }];
  config.cancel = false;
  config.jitter = 0;
  config.network = 10;
  await area.fill(JSON.stringify(config));
  await page.locator("#apply-config").click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  await page.locator("#single-deadline").fill("40");
  await page.locator("#single-deadline").blur();
  await page.locator("#send-request").click();
  await expect(page.locator(".trace-running-note")).toBeVisible();
  await pause(page);
  await expect(page.locator(".trace-summary .result")).toHaveText(
    "user deadline",
  );
  await expect(page.locator(".trace-summary .trace-duration")).toHaveText(
    "40 ms",
  );
  await expect(page.locator(".trace-chip.active")).toHaveClass(/error/);
  await expect(
    page.locator(".trace-row[data-span] .trace-label"),
  ).toContainText("In progress");
  await page.locator("#step").click();
  await expect(page.locator(".trace-running-note")).toHaveCount(0);
  await expect(page.locator(".trace-box-time")).toHaveText("500 ms");
  await expect(page.locator(".trace-summary .trace-duration")).toHaveText(
    "40 ms",
  );
  await expect(page.locator(".trace-ticks")).toContainText("530");
  const marker = page.locator(".trace-response-marker");
  const offset = await marker.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.left),
  );
  expect(offset).toBeCloseTo((40 / 530) * 100, 2);
});
