import { test, expect } from "@playwright/test";

test.use({ isMobile: true, hasTouch: true });
for (const width of [320, 360, 390, 430, 760]) {
  test(`canvas and bottom sheets remain usable at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem("tmlab.language", "en"),
    );
    await page.goto("/");
    await expect(page.locator("#clock")).not.toHaveText("00:00.0");
    await expect(page.locator("#settings-window")).toBeHidden();
    await page.locator("#pause").click();
    const time = await page.locator("#clock").textContent();
    for (const language of ["en", "ru"]) {
      await page.locator("#language").selectOption(language);
      await page.locator("#generator-node").click();
      for (const mode of ["load", "single"]) {
        await page.locator("#request-mode").selectOption(mode);
        await expect(page.locator("#single-request")).toHaveCount(
          mode === "single" ? 1 : 0,
        );
        const box = (await page.locator("#settings-window").boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        await expect(page.locator("#close-settings")).toBeInViewport();
        await expect(page.locator("#clock")).toHaveText(time!);
      }
      await page.locator("#single-weight").fill("2");
      await page.locator("#single-weight").blur();
      await page.locator("#request-locality > summary").click();
      await page.locator("#close-settings").click();
      await page.locator('[data-node="db-1"] .node-select').click();
      await page.locator("#box-locality > summary").click();
      await page.locator("#auto-controls > summary").click();
      await page.setViewportSize({ width: 844, height: width });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(844);
      await expect(page.locator("#close-settings")).toBeInViewport();
      if (width <= 600) {
        await expect(page.locator("#metrics-toggle")).toHaveAttribute(
          "aria-expanded",
          "false",
        );
        await expect(page.locator("#activity-toggle")).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      }
      await page.setViewportSize({ width, height: 844 });
      await page.locator("#close-settings").click();
      await page.locator("#generator-node").click();
      await expect(page.locator("#single-weight")).toHaveValue("2");
      await page.locator("#close-settings").click();
      expect(
        await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.scrollHeight,
        ]),
      ).toEqual([width, 844]);
    }
    // A manual request can be sent directly from the graph with the retained draft.
    await page.locator("#canvas-send-request").click();
    await expect(page.locator("#traces-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.locator(".trace-summary")).toBeVisible();
    const traceBounds = (await page.locator(".traces-dock").boundingBox())!;
    expect(traceBounds.x + traceBounds.width).toBeLessThanOrEqual(width);
    expect(traceBounds.y + traceBounds.height).toBeLessThanOrEqual(844);
    await page.locator("#traces-toggle").click();
    expect(errors).toEqual([]);
    if (width === 390)
      await page.screenshot({ path: "/tmp/tmlab-canvas-mobile.png" });
  });
}
