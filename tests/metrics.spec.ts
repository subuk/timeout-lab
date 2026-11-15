import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import type { Snapshot } from "../src/model";

declare global {
  interface Window {
    metricAudit: { snapshot: Snapshot; worker: Worker };
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tmlab.language", "en");
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        window.metricAudit = {
          snapshot: null as unknown as Snapshot,
          worker: this,
        };
        this.addEventListener("message", ({ data }) => {
          if (data.type === "snapshot") window.metricAudit.snapshot = data.data;
        });
      }
    };
  });
  page.on("pageerror", (error) => {
    throw error;
  });
});

for (const offline of [false, true]) {
  test(`metric charts inspect real virtual-time history${offline ? " offline" : ""}`, async ({
    page,
  }) => {
    await page.goto(
      offline ? `file://${resolve("dist/standalone.html")}` : "/",
    );
    await expect(page.locator("#clock")).not.toHaveText("00:00.0");
    await page.locator("#pause").click();
    await page.evaluate(() =>
      Array.from({ length: 9 }, () =>
        window.metricAudit.worker.postMessage({ type: "step", ms: 10000 }),
      ),
    );
    await expect
      .poll(() => page.evaluate(() => window.metricAudit.snapshot.t))
      .toBeGreaterThanOrEqual(90000);
    const before = await page.evaluate(() => window.metricAudit.snapshot);
    const points = before.history;
    const charts = page.locator(".metric-chart");
    await expect(charts).toHaveCount(4);
    await expect(page.locator(".activity-dock, #activity-toggle")).toHaveCount(
      0,
    );
    await expect(page.locator("#metrics-content #load-chart")).toBeVisible();
    const dock = (await page.locator(".metrics-dock").boundingBox())!;
    const traces = (await page.locator(".traces-dock").boundingBox())!;
    expect(dock.y + dock.height).toBeLessThanOrEqual(traces.y);
    expect(dock.y).toBeGreaterThan(500);
    for (const chart of await charts.all()) {
      await expect(chart).toBeVisible();
      expect(
        await chart.locator(".metric-chart-line").getAttribute("d"),
      ).toMatch(/^M.+L/);
    }
    await expect(charts.nth(2).locator(".metric-chart-axis text")).toHaveText([
      "0",
      "50",
      "100",
    ]);
    await charts.first().focus();
    await page.keyboard.press("Home");
    await expect(page.locator(".metric-chart-cursor")).toHaveCount(4);
    await expect(page.locator(".metrics-reading")).toHaveText(
      `${(points[0].t / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} s`,
    );
    for (const [selector, value, digits] of [
      ["#goodput", points[0].goodput, 1],
      ["#p95", points[0].p95, 0],
      ["#error-rate", points[0].errorRate, 1],
      ["#pending", points[0].pending, 0],
    ] as const) {
      await expect(page.locator(selector)).toHaveText(
        value.toLocaleString("en-US", { maximumFractionDigits: digits }),
      );
    }
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".metrics-reading")).toHaveText(
      `${(points[1].t / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} s`,
    );
    await page.keyboard.press("Escape");
    await expect(page.locator(".metrics-reading")).toHaveText("Now");
    // Pointer inspection uses the same timestamp on all four charts.
    const bounds = (await charts.nth(1).boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width * 0.6,
      bounds.y + bounds.height * 0.5,
    );
    await expect(page.locator(".metric-chart-cursor")).toHaveCount(4);
    await page.mouse.move(5, 5);
    await expect(page.locator(".metric-chart-cursor")).toHaveCount(0);
    await page.locator("#generator-node").click();
    for (const chart of await charts.all()) await expect(chart).toBeVisible();
    const rows = await page
      .locator(".metrics > article")
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().y),
      );
    expect(new Set(rows).size).toBe(1);
    await page.locator("#language").selectOption("ru");
    await expect(page.locator(".metrics-timeline")).toContainText(
      "Последние 60 с",
    );
    expect(
      (await page.evaluate(() => window.metricAudit.snapshot)).history,
    ).toEqual(points);
    await page.locator("#close-settings").click();
    await page.locator("#language").selectOption("en");
    if (!offline)
      await page.screenshot({ path: "/tmp/tmlab-metric-charts-desktop.png" });
    await charts.first().focus();
    await page.keyboard.press("Home");
    await page.locator("#reset").click();
    await expect(page.locator("#clock")).toHaveText("00:00.0");
    await expect(page.locator(".metric-chart-cursor")).toHaveCount(0);
    await expect(page.locator("#p95")).toHaveText("—");
    // No successful calls means no latency series, including after the window advances.
    await page.evaluate(() => {
      const { worker, snapshot } = window.metricAudit;
      worker.postMessage({
        type: "config",
        config: { ...snapshot.config, rps: 0 },
      });
      for (let i = 0; i < 7; i++)
        worker.postMessage({ type: "step", ms: 10000 });
    });
    await expect
      .poll(() => page.evaluate(() => window.metricAudit.snapshot.t))
      .toBe(70000);
    await expect(charts.nth(1).locator(".metric-chart-line")).toHaveAttribute(
      "d",
      /^\s*$/,
    );
    await expect(page.locator("#p95")).toHaveText("—");
    await expect(charts.first().locator(".metric-chart-line")).toHaveAttribute(
      "d",
      /^M.+L/,
    );
  });
}

for (const offline of [false, true])
  test(`mobile charts start folded and remain reachable${offline ? " offline" : ""}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      offline ? `file://${resolve("dist/standalone.html")}` : "/",
    );
    await expect(page.locator("#clock")).not.toHaveText("00:00.0");
    await page.locator("#pause").click();
    for (const id of ["metrics"]) {
      await expect(page.locator(`#${id}-toggle`)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(page.locator(`#${id}-content`)).toBeHidden();
    }
    const foldedArea = (await page.locator(".canvas-fit-area").boundingBox())!;
    await page.evaluate(() =>
      Array.from({ length: 5 }, () =>
        window.metricAudit.worker.postMessage({ type: "step", ms: 10000 }),
      ),
    );
    await expect
      .poll(() => page.evaluate(() => window.metricAudit.snapshot.t))
      .toBeGreaterThanOrEqual(45000);
    const time = await page.locator("#clock").textContent();
    await page.locator("#metrics-toggle").click();
    await expect(page.locator("#metrics-content")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await page.locator(".canvas-fit-area").boundingBox())!.height,
      )
      .toBeLessThan(foldedArea.height);
    await page.locator("#language").selectOption("ru");
    await expect(page.locator("#metrics-content")).toBeVisible();
    for (const chart of await page.locator(".metric-chart").all()) {
      await chart.scrollIntoViewIfNeeded();
      await expect(chart).toBeInViewport();
      const bounds = (await chart.boundingBox())!;
      expect(bounds.width).toBeGreaterThan(150);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    }
    expect(
      await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.scrollHeight,
      ]),
    ).toEqual([390, 844]);
    await page
      .locator(".metrics")
      .evaluate((element) => (element.scrollLeft = 0));
    await page.locator("#load-chart").scrollIntoViewIfNeeded();
    await expect(page.locator("#metrics-content #load-chart")).toBeInViewport();
    const activity = (await page.locator(".activity-metric").boundingBox())!;
    const chart = (await page.locator("#load-chart").boundingBox())!;
    expect(chart.y).toBeGreaterThan(activity.y);
    expect(chart.y + chart.height).toBeLessThanOrEqual(
      activity.y + activity.height,
    );
    expect(chart.width).toBeLessThan(activity.width);
    await page.locator("#metrics-toggle").click();
    await expect(page.locator("#load-chart")).toBeHidden();
    await expect(page.locator("#clock")).toHaveText(time!);
    await expect
      .poll(
        async () =>
          (await page.locator(".canvas-fit-area").boundingBox())!.height,
      )
      .toEqual(foldedArea.height);
    if (!offline)
      await page.screenshot({ path: "/tmp/tmlab-mobile-folded.png" });
  });

test("combined bottom panels stay separate and leave a usable canvas", async ({
  page,
}) => {
  for (const [width, height] of [
    [1440, 1100],
    [1000, 800],
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator("#clock")).not.toHaveText("00:00.0");
    await page.locator("#pause").click();
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++)
        window.metricAudit.worker.postMessage({ type: "step", ms: 10000 });
    });
    if (await page.locator("#metrics-content").isHidden())
      await page.locator("#metrics-toggle").click();
    await page.locator("#traces-toggle").click();
    await expect(page.locator(".trace-summary")).toBeVisible();
    const metrics = (await page.locator(".metrics-dock").boundingBox())!;
    const traces = (await page.locator(".traces-dock").boundingBox())!;
    const toolbar = (await page.locator(".lab-toolbar").boundingBox())!;
    expect(metrics.y + metrics.height).toBeLessThanOrEqual(traces.y);
    const stack = (await page.locator(".telemetry-stack").boundingBox())!;
    expect(stack.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    expect(stack.y + stack.height).toBeLessThanOrEqual(height);
    await page.locator("#traces-toggle").scrollIntoViewIfNeeded();
    await expect(page.locator("#traces-toggle")).toBeInViewport();
    await page.locator("#metrics-toggle").scrollIntoViewIfNeeded();
    await expect(page.locator("#metrics-toggle")).toBeInViewport();
    await expect
      .poll(
        async () =>
          (await page.locator(".canvas-fit-area").boundingBox())!.height,
      )
      .toBeGreaterThan(40);
    await page.screenshot({ path: `/tmp/tmlab-combined-panels-${width}.png` });
  }
});
