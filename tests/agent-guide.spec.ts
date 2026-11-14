import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tmlab.language", "en"));
});
test.afterEach(({ page }) => expect(failures.get(page)).toEqual([]));

test("guide copies an edited prompt without changing the experiment", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#template=numa");
  await expect(page.locator("#clock")).not.toHaveText("00:00.0");
  await page.locator("#pause").click();
  await expect(page.locator("body")).toHaveClass(/\bpaused\b/);
  const time = await page.locator("#clock").textContent();
  const url = page.url();
  await page.locator("#create-with-agent").click();
  const dialog = page.locator("#agent-guide");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#agent-guide-title")).toBeFocused();
  const prompt = page.locator("#agent-prompt");
  const initial = await prompt.inputValue();
  expect(initial).toContain("https://tmlab.krglv.com/skill.md");
  const edited = initial + "\nAdd a shared resource named Pool 🧪.";
  await prompt.fill(edited);
  await dialog
    .getByRole("button", { name: "Copy prompt", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(edited);
  await expect(dialog.getByRole("status")).not.toBeEmpty();
  await prompt.fill(edited + " Keep total RPS unchanged.");
  await expect(dialog.getByRole("status")).toBeEmpty();
  await prompt.fill("");
  await expect(
    dialog.getByRole("button", { name: "Copy prompt", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#create-with-agent")).toBeFocused();
  await expect(page.locator("#clock")).toHaveText(time!);
  await expect(page.locator("#preset")).toHaveValue("numa");
  expect(page.url()).toBe(url);
});

test("standalone guide uses public instructions and offers manual copying", async ({
  page,
}) => {
  await page.goto(pathToFileURL(resolve("dist/standalone.html")).href);
  await expect(page.locator("#clock")).not.toHaveText("00:00.0");
  await page.locator("#language").selectOption("ru");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.locator("#create-with-agent").click();
  const prompt = page.locator("#agent-prompt");
  const text = await prompt.inputValue();
  expect(text).toContain("https://tmlab.krglv.com/skill.md");
  expect(text).toContain("Моя система:");
  await expect(page.locator("#agent-guide a")).toHaveAttribute(
    "href",
    "https://tmlab.krglv.com/skill.md",
  );
  await page
    .getByRole("button", { name: "Скопировать запрос", exact: true })
    .click();
  await expect(prompt).toBeFocused();
  expect(
    await prompt.evaluate(
      (input: HTMLTextAreaElement) => input.selectionEnd - input.selectionStart,
    ),
  ).toBe(text.length);
  await expect(page.locator("#agent-guide [role=status]")).not.toBeEmpty();
  await page
    .locator("#agent-guide")
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
  await expect(page.locator("#create-with-agent")).toBeFocused();
});

for (const [width, height] of [
  [320, 844],
  [390, 844],
  [844, 390],
  [1000, 800],
  [1200, 900],
  [1440, 1100],
]) {
  test(`agent entry and guide fit ${width}×${height} in both languages`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator("#clock")).not.toHaveText("00:00.0");
    for (const language of ["en", "ru"]) {
      await page.locator("#language").selectOption(language);
      const entry = page.locator("#create-with-agent");
      await expect(entry).toBeInViewport();
      // A visible toolbar entry must not overlap its neighboring controls.
      const controls = await page
        .locator(".lab-toolbar > *")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
      for (let i = 0; i < controls.length; i++) {
        const box = controls[i];
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        for (const other of controls.slice(i + 1)) {
          const intersection =
            Math.min(box.x + box.width, other.x + other.width) -
            Math.max(box.x, other.x);
          const vertical =
            Math.min(box.y + box.height, other.y + other.height) -
            Math.max(box.y, other.y);
          expect(intersection > 1 && vertical > 1).toBe(false);
        }
      }
      const toolbar = (await page.locator(".lab-toolbar").boundingBox())!;
      const metrics = (await page.locator(".metrics-dock").boundingBox())!;
      expect(metrics.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
      if (language === "ru" && [390, 1440].includes(width))
        await page.screenshot({ path: `/tmp/tmlab-agent-entry-${width}.png` });
      await entry.click();
      const dialog = page.locator("#agent-guide");
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      await expect(dialog.locator(".modal-head button")).toBeInViewport();
      await expect(
        dialog.locator(".agent-guide-footer button"),
      ).toBeInViewport();
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      if (language === "ru" && [390, 1440].includes(width))
        await page.screenshot({ path: `/tmp/tmlab-agent-guide-${width}.png` });
      await page.keyboard.press("Escape");
    }
  });
}
