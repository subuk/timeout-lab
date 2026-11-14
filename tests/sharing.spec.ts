import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { modelFromHash, modelURL } from "../src/sharing";
import type { Config } from "../src/model";

const skill = readFileSync("public/skill.md", "utf8");
const example: Config = JSON.parse(skill.match(/```json\n([\s\S]*?)\n```/)![1]);
const model: Config = {
  ...example,
  name: "Модель 🧪",
  groups: example.groups.map((g) => ({
    ...g,
    name: g.id === "api" ? "API <custom> 🧪" : "База",
  })),
};
const hash = (value: unknown) =>
  "#model=" + Buffer.from(JSON.stringify(value)).toString("base64url");
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tmlab.language", "en"));
});
test.afterEach(({ page }) => expect(failures.get(page)).toEqual([]));

async function loaded(page: Page) {
  await expect(page.locator("#preset")).toHaveValue("custom");
  await expect(page.locator('[data-group="api"] .group-title')).toContainText(
    "API <custom> 🧪",
  );
  await expect(page.locator(".error-banner")).toHaveCount(0);
}
async function config(page: Page) {
  await page.locator("#edit-config").click();
  const value = JSON.parse(await page.locator("#config-editor").inputValue());
  await page
    .locator("#config-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  return value;
}

test("URL encoding round-trips Unicode and bounds malformed input", () => {
  const url = modelURL(model, "https://example.test/#template=normal");
  expect(modelFromHash(new URL(url).hash)).toEqual(model);
  expect(url).not.toContain("template=");
  expect(modelFromHash("#template=normal")).toBeNull();
  for (const value of [
    "#model=",
    "#model=???",
    hash(null),
    hash([]),
    "#model=_w",
  ])
    expect(() => modelFromHash(value)).toThrow("Invalid model link");
  expect(() => modelFromHash("#model=" + "a".repeat(180000))).toThrow(
    "too large",
  );
  expect(() =>
    modelURL(
      { ...model, description: "x".repeat(131073) },
      "https://example.test/",
    ),
  ).toThrow("too large");
});

for (const standalone of [false, true]) {
  test(`custom model loads, shares edits and reloads (${standalone ? "offline" : "HTTP"})`, async ({
    page,
  }) => {
    const base = standalone
      ? pathToFileURL(resolve("dist/standalone.html")).href
      : "/";
    await page.goto(base + hash(model));
    await loaded(page);
    expect(
      (await config(page)).groups.map((g: { name: string }) => g.name),
    ).toEqual(model.groups.map((g) => g.name));
    await page.reload();
    await loaded(page);
    await page.locator("#edit-config").click();
    const edited = JSON.parse(
      await page.locator("#config-editor").inputValue(),
    );
    edited.rps = 17;
    await page.locator("#config-editor").fill(JSON.stringify(edited));
    await page
      .getByRole("button", { name: "Apply without reset", exact: true })
      .click();
    await page.locator("#share-model").click();
    if (!standalone)
      await page.screenshot({ path: "/tmp/timeout-lab-share-desktop.png" });
    const url = await page
      .getByRole("textbox", { name: "Model link", exact: true })
      .inputValue();
    expect(modelFromHash(new URL(url).hash)?.rps).toBe(17);
    await page.goto(url);
    await loaded(page);
    expect((await config(page)).rps).toBe(17);
    await page.locator("#generator-node").click();
    await page.locator("#request-mode").selectOption("single");
    await page.locator("#reset").click();
    await page.locator("#send-request").click();
    await expect(page.locator("#trace-events tbody tr").first()).toBeVisible();
    await expect(page.locator("#send-request")).toBeEnabled();
    await expect(page.locator(".trace-summary .result")).toHaveText("success");
    if (standalone) expect(url).toMatch(/^file:/);
  });
}

test("history restores custom models and presets; invalid links preserve the experiment", async ({
  page,
}) => {
  await page.goto("/" + hash(model));
  await loaded(page);
  await page.locator("#preset").selectOption("numa");
  await expect(page.locator('[data-group="cpu"]')).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#template=numa");
  await page.goBack();
  await loaded(page);
  await page.goForward();
  await expect(page.locator("#preset")).toHaveValue("numa");
  await page.evaluate((value) => {
    location.hash = value;
  }, hash(model));
  await loaded(page);
  await page.locator("#pause").click();
  const time = await page.locator("#clock").textContent();
  const before = await config(page);
  for (const invalid of [
    "#model=broken!",
    hash({ ...model, edges: [] }),
    hash({ ...model, entry: "missing" }),
    "#model=" + "a".repeat(180000),
  ]) {
    await page.evaluate((value) => {
      location.hash = value;
    }, invalid);
    await expect(page.locator(".error-banner")).toBeVisible();
    expect(await config(page)).toEqual(before);
    await expect(page.locator("#clock")).toHaveText(time!);
  }
  await page.locator("#preset").selectOption("normal");
  await expect(page.locator(".error-banner")).toHaveCount(0);
});

test("public skill example runs and model takes precedence over preset", async ({
  page,
  request,
}) => {
  expect(await (await request.get("/skill.md")).text()).toBe(skill);
  await page.goto("/" + hash(example) + "&template=numa");
  await expect(page.locator("#preset")).toHaveValue("custom");
  await expect(page.locator('[data-group="api"]')).toBeVisible();
  await expect(page.locator('[data-group="cpu"]')).toHaveCount(0);
  await expect(page.locator("#clock")).not.toHaveText("00:00.0");
  await expect(page.locator(".error-banner")).toHaveCount(0);
});

test("sharing works on mobile in Russian with clipboard unavailable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/" + hash(model));
  await loaded(page);
  await page.locator("#language").selectOption("ru");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.locator("#share-model").click();
  await page
    .getByRole("button", { name: "Копировать ссылку", exact: true })
    .click();
  const area = page.getByRole("textbox", {
    name: "Ссылка на модель",
    exact: true,
  });
  const url = await area.inputValue();
  expect(modelFromHash(new URL(url).hash)?.name).toBe(model.name);
  expect(
    await area.evaluate(
      (element: HTMLTextAreaElement) =>
        element.selectionEnd - element.selectionStart,
    ),
  ).toBe(url.length);
  const box = await page.locator("#share-dialog").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/timeout-lab-share-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#share-dialog")).toHaveCount(0);
});
