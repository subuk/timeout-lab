import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

for (const standalone of [false, true]) {
  for (const language of ["en", "ru"]) {
    test(`model help is a dismissible modal and preserves the experiment (${language}, ${standalone ? "offline" : "HTTP"})`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        (value) => localStorage.setItem("tmlab.language", value),
        language,
      );
      await page.goto(
        standalone ? `file://${resolve("dist/standalone.html")}` : "/",
      );
      await expect(page.locator("#clock")).not.toHaveText("00:00.0");
      await page.locator("#pause").click();
      await expect(page.locator("#live-state")).toHaveClass(/paused/);
      await page.locator('[data-node="db-1"] .node-select').click();
      await page.locator("#workers").fill("37");
      await page.locator("#workers").blur();
      const time = await page.locator("#clock").textContent();
      const trigger = page.locator("#model-info");
      const dialog = page.getByRole("dialog", {
        name: (await trigger.getAttribute("aria-label"))!,
        exact: true,
      });
      const before = await page.locator(".lab-toolbar").boundingBox();
      await trigger.click();
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((node) => node.matches(":modal"))).toBe(
        true,
      );
      await expect(page.locator("#model-help-title")).toBeFocused();
      expect(await page.locator(".lab-toolbar").boundingBox()).toEqual(before);
      if (language === "ru") {
        await expect(dialog.locator("#model-help-intro")).toContainText(
          /[А-Яа-я]/,
        );
        for (const summary of await dialog.locator("summary").all())
          await expect(summary).toContainText(/[А-Яа-я]/);
      }

      // Keyboard navigation cannot reach controls behind the native modal.
      for (let index = 0; index < 10; index++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate(
            (node) =>
              // Native dialogs can yield focus to browser chrome when wrapping.
              document.activeElement === document.body ||
              node.contains(document.activeElement),
          ),
        ).toBe(true);
      }
      const topic = dialog.locator("details").first();
      await topic.locator("summary").click();
      await expect(topic).toHaveAttribute("open", "");
      await topic.locator("summary").click();
      await dialog.locator(".model-help-body").evaluate((node) => {
        node.scrollTop = 0;
      });
      if (!standalone)
        await page.screenshot({
          path: `/tmp/tmlab-help-${language}-desktop.png`,
        });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await trigger.click();
      await dialog.locator(".modal-head button").click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.mouse.click(2, 2);
      await expect(dialog).toHaveCount(0);

      for (const width of [320, 390, 760]) {
        await page.setViewportSize({ width, height: 844 });
        await trigger.click();
        const bounds = (await dialog.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
        const body = dialog.locator(".model-help-body");
        expect(
          await body.evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        await expect(dialog.locator(".modal-head button")).toBeInViewport();
        await expect(
          dialog.locator(".model-help-footer button"),
        ).toBeInViewport();
        if (width === 320 && !standalone)
          await page.screenshot({
            path: `/tmp/tmlab-help-${language}-mobile.png`,
          });
        await dialog.locator("summary").last().click();
        await expect(dialog.locator("details").last()).toHaveAttribute(
          "open",
          "",
        );
        await expect(
          dialog.locator("details").last().locator("p").last(),
        ).toBeVisible();
        await dialog.locator(".model-help-footer button").click();
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
      await expect(page.locator("#clock")).toHaveText(time!);
      await expect(page.locator("#live-state")).toHaveClass(/paused/);
      await expect(page.locator("#workers")).toHaveValue("37");
      expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

      // Reading help also leaves a running experiment running.
      await page.locator("#pause").click();
      await trigger.click();
      await expect(page.locator("#clock")).not.toHaveText(time!);
      await expect(page.locator("#live-state")).not.toHaveClass(/paused/);
      await page.keyboard.press("Escape");
      expect(errors).toEqual([]);
    });
  }
}
