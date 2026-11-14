import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tmlab.language", "en"));
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/");
  await expect(page.locator("#clock")).not.toHaveText("00:00.0");
});

test("pan, zoom and fit move only the diagram and preserve virtual time", async ({
  page,
}) => {
  await expect(page.locator("#settings-window")).toBeHidden();
  await expect(page.locator("#generator-node")).toHaveCount(1);
  await expect(page.locator("#traces-content")).toBeHidden();
  await expect(page.locator("#metrics-content")).toBeVisible();
  await expect(page.locator("#activity-content")).toBeVisible();
  await page.locator("#pause").click();
  const time = await page.locator("#clock").textContent();
  const metrics = await page.locator(".metrics-dock").boundingBox();
  const activity = await page.locator(".activity-dock").boundingBox();
  const generator = page.locator("#generator-node");
  const before = (await generator.boundingBox())!;
  await page.locator("#zoom-in").click();
  expect((await generator.boundingBox())!.width).toBeGreaterThan(before.width);
  const canvas = page.locator(".canvas-viewport");
  await canvas.focus();
  const shifted = (await generator.boundingBox())!;
  await page.keyboard.press("ArrowRight");
  expect((await generator.boundingBox())!.x).toBeCloseTo(shifted.x - 50, 0);
  await page.mouse.move(700, 760);
  await page.mouse.down();
  await page.mouse.move(800, 780, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(80, 50);
  await expect
    .poll(async () => (await generator.boundingBox())!.x)
    .not.toBe(shifted.x - 50);
  expect(await page.locator(".metrics-dock").boundingBox()).toEqual(metrics);
  expect(await page.locator(".activity-dock").boundingBox()).toEqual(activity);
  await page.locator("#fit-canvas").click();
  const fitted = (await page.locator(".canvas-world").boundingBox())!;
  const area = (await page.locator(".canvas-fit-area").boundingBox())!;
  expect(fitted.x).toBeGreaterThanOrEqual(area.x - 1);
  expect(fitted.y).toBeGreaterThanOrEqual(area.y - 1);
  expect(fitted.x + fitted.width).toBeLessThanOrEqual(area.x + area.width + 1);
  expect(fitted.y + fitted.height).toBeLessThanOrEqual(
    area.y + area.height + 1,
  );
  await expect(page.locator("#clock")).toHaveText(time!);
  await page.screenshot({ path: "/tmp/tmlab-canvas-desktop.png" });
});

test("nonmodal settings follow selections, preserve drafts and keep total traffic on scaling", async ({
  page,
}) => {
  await page.locator("#pause").click();
  const time = await page.locator("#clock").textContent();
  await page.locator("#generator-node").click();
  await expect(page.locator("#settings-window")).toHaveAttribute(
    "aria-modal",
    "false",
  );
  await page.locator("#rps").fill("73");
  await page.waitForTimeout(250);
  await expect(page.locator("#rps")).toBeFocused();
  await page.locator("#rps").blur();
  await expect(page.locator(".generator-value")).toContainText("73");
  await page.locator('[data-group="api"] .group-heading').click();
  await expect(page.locator("#selected-id")).toHaveText("api");
  await page.locator("#node-count").fill("5");
  await page.locator("#node-count").blur();
  await expect(page.locator('[data-group="api"] .box')).toHaveCount(5);
  await expect(page.locator(".generator-value")).toContainText("73");
  await page
    .locator('[data-node="db-1"] .resource-bar')
    .filter({ hasText: "Disk" })
    .click();
  await expect(
    page.locator('#resource-tabs button[aria-pressed="true"]'),
  ).toHaveText("Disk");
  await page.screenshot({ path: "/tmp/tmlab-canvas-settings.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-window")).toBeHidden();
  await page.locator("#generator-node").focus();
  await page.keyboard.press("Enter");
  await page.locator("#request-mode").selectOption("single");
  await page.locator("#single-weight").fill("2");
  await page.locator("#single-weight").blur();
  await page.locator("#single-labels").fill("site=east");
  await page.locator("#language").selectOption("ru");
  await expect(page.locator("#single-weight")).toHaveValue("2");
  await page.locator("#close-settings").click();
  await page.locator("#generator-node").click();
  await expect(page.locator("#single-labels")).toHaveValue("site=east");
  await expect(page.locator("#clock")).toHaveText(time!);
});

test("graph send uses the generator draft, reveals validation and retains folded traces", async ({
  page,
}) => {
  const requests: {
    weight: number;
    deadline: number;
    labels: Record<string, string>;
  }[] = [];
  await page.exposeFunction(
    "captureRequest",
    (value: (typeof requests)[number]) => requests.push(value),
  );
  // Observe actual Worker messages without replacing any simulation behavior.
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      postMessage(value: any) {
        if (value.type === "request")
          (window as any).captureRequest(value.request);
        super.postMessage(value);
      }
    };
  });
  await page.reload();
  await page.locator("#generator-node").click();
  await page.locator("#request-mode").selectOption("single");
  await page.locator("#single-weight").fill("2");
  await page.locator("#single-weight").blur();
  await page.locator("#single-deadline").fill("1234");
  await page.locator("#single-deadline").blur();
  await page.locator("#single-weight").fill("");
  await page.locator("#single-weight").blur();
  await page.locator("#close-settings").click();
  await page.locator("#canvas-send-request").click();
  await expect(page.locator("#settings-window")).toBeVisible();
  await expect(page.locator("#single-weight")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(requests).toEqual([]);
  await page.locator("#single-weight").fill("2");
  await page.locator("#single-weight").blur();
  await page.locator("#single-labels").fill("invalid");
  await page.locator("#close-settings").click();
  await page.locator("#canvas-send-request").click();
  await expect(page.locator("#settings-window")).toBeVisible();
  await expect(page.locator("#single-request [role=status]")).toContainText(
    "key=value",
  );
  expect(requests).toEqual([]);
  await page.locator("#single-labels").fill("site=east");
  await page.locator("#close-settings").click();
  await page.locator("#canvas-send-request").click();
  await expect(page.locator("#canvas-send-request")).toBeEnabled();
  await expect
    .poll(() => requests)
    .toEqual([{ weight: 2, deadline: 1234, labels: { site: "east" } }]);
  await expect(page.locator("#traces-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator(".trace-chip.active")).toBeVisible();
  const selected = await page
    .locator(".trace-chip.active")
    .getAttribute("data-trace");
  await page.locator("#traces-toggle").click();
  await expect(page.locator("#traces-content")).toBeHidden();
  await page.locator("#step").click();
  await page.locator("#traces-toggle").click();
  await expect(page.locator(".trace-chip.active")).toHaveAttribute(
    "data-trace",
    selected!,
  );
  await page.locator("#metrics-toggle").click();
  await page.locator("#activity-toggle").click();
  await expect(page.locator("#metrics-content")).toBeHidden();
  await expect(page.locator("#activity-content")).toBeHidden();
});
