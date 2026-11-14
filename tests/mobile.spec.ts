import { test, expect } from "@playwright/test";

test.use({ isMobile: true, hasTouch: true });

for (const width of [320, 360, 390, 430, 760]) {
  test(`mobile panels fill the page at ${width}px in both languages and request modes`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem("tmlab.language", "en"),
    );
    await page.goto("/");
    await expect(page.locator("#selected-id")).toHaveText("db-1");
    await expect(page.locator("#clock")).not.toHaveText("00:00.0");
    await page.locator("#pause").click();
    await expect(page.locator("#pause")).toContainText("Resume");
    const time = await page.locator("#clock").textContent();
    const panels = page.locator(
      ".workspace > .panel, .center-column > .panel, .right-column > .panel",
    );
    for (const language of ["en", "ru"]) {
      await page.locator("#language").selectOption(language);
      for (const mode of ["load", "single"]) {
        await page.locator("#request-mode").selectOption(mode);
        await expect(page.locator("#single-request")).toHaveCount(
          mode === "single" ? 1 : 0,
        );
        const bounds = await page.locator(".workspace").boundingBox();
        for (const panel of await panels.all()) {
          const box = (await panel.boundingBox())!;
          expect(Math.abs(box.x - bounds!.x)).toBeLessThan(1);
          expect(Math.abs(box.width - bounds!.width)).toBeLessThan(1);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await expect(page.locator("#clock")).toHaveText(time!);
      }
    }
    // Panel width must also survive expanded forms and orientation changes.
    await page.locator("#request-locality > summary").click();
    await page.locator("#box-locality > summary").click();
    await page.locator("#auto-controls > summary").click();
    await page.setViewportSize({ width: 844, height: width });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(844);
    await page.setViewportSize({ width, height: 844 });
    const bounds = (await page.locator(".workspace").boundingBox())!;
    for (const panel of await panels.all())
      expect((await panel.boundingBox())!.width).toBeCloseTo(bounds.width, 0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.locator("#single-weight").fill("2");
    await page.locator("#single-weight").blur();
    await expect(page.locator("#single-weight")).toHaveValue("2");
    await expect(page.locator("#clock")).toHaveText(time!);
    expect(errors).toEqual([]);
    if (width === 390) {
      await page
        .locator(".workspace > .panel")
        .screenshot({ path: "/tmp/tmlab-mobile-generator-fixed.png" });
      await page
        .locator(".inspector")
        .screenshot({ path: "/tmp/tmlab-mobile-inspector-fixed.png" });
    }
  });
}
