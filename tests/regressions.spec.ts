import { test, expect, type Page } from "@playwright/test";
import type { Snapshot } from "../src/model";
declare global {
  interface Window {
    audit: { snapshot: Snapshot; commands: { type: string }[] };
  }
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tmlab.language", "en");
    window.audit = { snapshot: null as unknown as Snapshot, commands: [] };
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "snapshot") window.audit.snapshot = data.data;
        });
      }
      postMessage(data: unknown) {
        window.audit.commands.push(data as { type: string });
        super.postMessage(data);
      }
    };
  });
  page.on("pageerror", (error) => {
    throw error;
  });
});
async function ready(page: Page, preset = "normal") {
  await page.goto(`/#template=${preset}`);
  await expect(page.locator("#clock")).not.toHaveText("00:00.0");
  await expect(page.locator(".box").first()).toBeVisible();
  const target =
    preset === "numa"
      ? "cpu-1"
      : ["composition", "autoscale"].includes(preset)
        ? "api-1"
        : "db-1";
  await page.locator(`[data-node="${target}"] .node-select`).click();
}
async function pause(page: Page) {
  if ((await page.locator("#pause").textContent())?.includes("Pause"))
    await page.locator("#pause").click();
  await expect(page.locator("#pause")).toContainText("Resume");
}
async function json(page: Page) {
  await page.locator("#edit-config").click();
  return page.locator("#config-editor");
}
async function number(page: Page, selector: string, value: string) {
  await page.locator(selector).fill(value);
  await page.locator(selector).blur();
}

test("queue limits are visible and edit the selected box definition without resetting", async ({
  page,
}) => {
  await ready(page, "composition");
  await pause(page);
  const before = await page.evaluate(() => window.audit.snapshot);
  const time = await page.locator("#clock").textContent();
  await page.locator("#resource-tabs button").first().click();
  await expect(page.locator("#queue-limit")).toBeVisible();
  await page
    .locator(".inspector")
    .screenshot({ path: "/tmp/tmlab-queue-en.png" });
  await number(page, "#queue-limit", "17");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.audit.snapshot.config.groups.find((g) => g.id === "api")!
            .queueLimit,
      ),
    )
    .toBe(17);
  await page.locator('[data-scope="group"]').click();
  await expect(page.locator("#queue-limit")).toHaveValue("17");
  await page.locator('[data-scope="node"]').click();
  await page
    .locator("#resource-tabs button")
    .filter({ hasText: "Memory" })
    .click();
  await number(page, "#queue-limit", "0");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.audit.snapshot.config.groups
            .find((g) => g.id === "api")!
            .resources!.find((r) => r.id === "compute")!
            .resources!.find((r) => r.id === "memory")!.queueLimit,
      ),
    )
    .toBe(0);
  await page.locator("#language").selectOption("ru");
  await expect(
    page.getByRole("spinbutton", {
      name: "Лимит очереди, запросов",
      exact: true,
    }),
  ).toHaveValue("0");
  await page
    .locator(".inspector")
    .screenshot({ path: "/tmp/tmlab-queue-ru.png" });
  await page.locator("#language").selectOption("en");
  await number(page, "#queue-limit", "2001");
  await expect(page.locator("#queue-limit")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await number(page, "#queue-limit", "1.5");
  await expect(page.locator("#queue-limit")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await number(page, "#queue-limit", "0");
  await expect(page.locator("#queue-limit")).toHaveValue("0");
  await expect(page.locator("#clock")).toHaveText(time!);
  const after = await page.evaluate(() => window.audit.snapshot);
  expect(after.t).toBe(before.t);
  expect(after.history).toEqual(before.history);
  expect(after.nodes.map((n) => [n.id, n.queue, n.active])).toEqual(
    before.nodes.map((n) => [n.id, n.queue, n.active]),
  );
  expect(after.config.overrides).toEqual(before.config.overrides);
  const expected = structuredClone(before.config);
  const group = expected.groups.find((g) => g.id === "api")!;
  group.queueLimit = 17;
  group
    .resources!.find((r) => r.id === "compute")!
    .resources!.find((r) => r.id === "memory")!.queueLimit = 0;
  expect(after.config).toEqual(expected);
  await page.locator("#edit-resources").click();
  const editor = page.locator(".program-editor");
  await editor
    .getByLabel("Box", { exact: true })
    .selectOption("compute/memory");
  await expect(
    editor.getByRole("spinbutton", {
      name: "Queue limit, requests",
      exact: true,
    }),
  ).toHaveValue("0");
});

test("nested forms retain relative targets, zero overrides and incomplete JSON safely", async ({
  page,
}) => {
  await ready(page, "composition");
  await pause(page);
  const time = await page.locator("#clock").textContent();
  await page.locator("#edit-resources").click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const area = page.locator("#config-editor"),
    original = await area.inputValue();
  await area.fill('{"stages":null}');
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".program-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await area.fill(original);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const editor = page.locator(".program-editor");
  await editor.getByLabel("Box", { exact: true }).selectOption("app");
  await expect(
    editor.getByLabel("Target", { exact: true }).first(),
  ).toHaveValue("r:../compute");
  await editor.getByLabel("Box", { exact: true }).selectOption("compute");
  await expect(editor.getByLabel("Target", { exact: true })).toHaveValue(
    "r:memory",
  );
  const targets = await editor
    .getByLabel("Target", { exact: true })
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value),
    );
  expect(targets).toContain("r:../app");
  await page
    .locator("#config-dialog")
    .screenshot({ path: "/tmp/tmlab-program-editor.png" });
  await editor
    .getByLabel("Box", { exact: true })
    .selectOption("compute/memory");
  const service = editor.getByRole("spinbutton", {
    name: "Processing, ms",
    exact: true,
  });
  await service.fill("10001");
  await service.blur();
  await page
    .getByRole("button", { name: "Apply without reset", exact: true })
    .click();
  await expect(page.locator("#config-error")).toContainText(
    "highlighted fields",
  );
  await service.fill("0");
  await service.blur();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/tmlab-editor-mobile.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page
    .getByRole("button", { name: "Apply without reset", exact: true })
    .click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  await expect(page.locator("#clock")).toHaveText(time!);
  expect(
    await page.evaluate(
      () =>
        window.audit.snapshot.config.groups
          .find((g) => g.id === "api")!
          .resources!.find((r) => r.id === "compute")!.resources![0].service,
    ),
  ).toBe(0);
});

test("editor merges numeric edits with live autoscaling and reports same-field conflicts", async ({
  page,
}) => {
  await ready(page, "autoscale");
  await expect(page.locator("#node-count")).toHaveValue("1");
  await page.locator("#speed").selectOption("5");
  await page.locator("#edit-resources").click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const area = page.locator("#config-editor"),
    draft = JSON.parse(await area.inputValue());
  draft.resources[0].service = 81;
  await area.fill(JSON.stringify(draft));
  await page.waitForFunction(
    () =>
      window.audit.snapshot.config.groups.find((g) => g.id === "api")!.count >
      1,
  );
  const before = await page.evaluate(() => ({
    count: window.audit.snapshot.config.groups.find((g) => g.id === "api")!
      .count,
    t: window.audit.snapshot.t,
  }));
  await page
    .getByRole("button", { name: "Apply without reset", exact: true })
    .click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  const after = await page.evaluate(() => ({
    group: window.audit.snapshot.config.groups.find((g) => g.id === "api")!,
    t: window.audit.snapshot.t,
  }));
  expect(after.group.count).toBeGreaterThanOrEqual(before.count);
  expect(after.group.resources![0].service).toBe(81);
  expect(after.t).toBeGreaterThanOrEqual(before.t);
  await page.locator("#edit-resources").click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const conflict = JSON.parse(await area.inputValue());
  conflict.count = 16;
  await area.fill(JSON.stringify(conflict));
  await page.waitForFunction(
    (count) =>
      window.audit.snapshot.config.groups.find((g) => g.id === "api")!.count !==
      count,
    after.group.count,
  );
  await page
    .getByRole("button", { name: "Apply without reset", exact: true })
    .click();
  await expect(page.locator("#config-error")).toContainText(
    "changed while the editor was open",
  );
});

test("preset selection follows the new model and back navigation resets only once", async ({
  page,
}) => {
  await ready(page, "numa");
  await page.locator("#preset").selectOption("slow");
  await expect(page.locator("#selected-id")).toHaveText("db-1/~storage");
  await page.locator("#preset").selectOption("numa");
  await expect(page.locator("#selected-id")).toHaveText("cpu-1");
  await page.locator("#preset").selectOption("autoscale");
  await expect(page.locator("#selected-id")).toHaveText("api");
  await page.evaluate(() => {
    window.audit.commands = [];
  });
  await page.goBack();
  await expect(page.locator("#selected-id")).toHaveText("cpu-1");
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () => window.audit.commands.filter((c) => c.type === "preset").length,
    ),
  ).toBe(1);
});

test("draining nodes keep accepted work and accept worker and duration edits", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#generator-node").click();
  await page.locator("#cancel").click();
  await expect(page.locator("#cancel")).not.toBeChecked();
  await page.locator('[data-node="api-4"] .node-select').click();
  await page.locator("#fault").selectOption("hang");
  await page.locator("#step").click();
  await number(page, "#node-count", "1");
  await expect(page.locator('[data-node="api-4"]')).toHaveClass(/draining/);
  const time = await page.locator("#clock").textContent();
  await number(page, "#workers", "37");
  await number(page, "#service", "23");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const n = window.audit.snapshot.nodes.find((n) => n.id === "api-4")!;
        return [n.workers, n.service, n.draining, n.active > 0];
      }),
    )
    .toEqual([37, 23, true, true]);
  await expect(page.locator("#clock")).toHaveText(time!);
});

test("bounds and autoscale integer limits keep invalid drafts without sending commands", async ({
  page,
}) => {
  await ready(page, "autoscale");
  await pause(page);
  await page.evaluate(() => {
    window.audit.commands = [];
  });
  await page.locator("#generator-node").click();
  await number(page, "#rps", "5000");
  await expect(page.locator("#rps")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#rps")).toHaveValue("5000");
  await number(page, "#network", "5001");
  await expect(page.locator("#network")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.locator('[data-node="api-1"] .node-select').click();
  await page.locator('[data-group="api"] .autoscale-card').click();
  const min = page
    .locator("#auto-controls")
    .getByRole("spinbutton", { name: "Minimum", exact: true });
  await min.fill("1.5");
  await min.blur();
  await expect(min).toHaveAttribute("aria-invalid", "true");
  expect(
    await page.evaluate(
      () => window.audit.commands.filter((c) => c.type === "config").length,
    ),
  ).toBe(0);
  await expect(page.locator(".auto-readings")).toContainText("Queue per node");
  await expect(page.locator(".auto-readings")).toContainText("Target");
  await page.locator("#generator-node").click();
  await number(page, "#rps", "250");
  await expect
    .poll(() => page.evaluate(() => window.audit.snapshot.config.rps))
    .toBe(250);
  const range = page.getByRole("slider", {
    name: "Traffic into the entry group · Slider",
    exact: true,
  });
  await range.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => page.evaluate(() => window.audit.snapshot.config.rps))
    .toBeGreaterThan(250);
});

test("manual status, connection failures and per-call resource expansion are explicit", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#generator-node").click();
  await page.locator("#request-mode").selectOption("single");
  await page.locator("#reset").click();
  await expect(page.locator("#clock")).toHaveText("00:00.0");
  await expect(page.locator(".metrics article").first()).toContainText(
    "background arrivals stopped",
  );
  await expect(page.locator("#single-request")).toContainText("Ready to send");
  await number(page, "#single-deadline", "1");
  await page.locator("#send-request").click();
  await expect(page.locator("#send-request")).toBeEnabled();
  await expect(page.locator(".connection-state").first()).toContainText(
    "Not established",
  );
  await number(page, "#single-deadline", "3000");
  await page.locator("#send-request").click();
  await expect(page.locator("#send-request")).toBeEnabled();
  await expect(page.locator(".trace-chip.active")).toHaveAttribute(
    "data-trace",
    "2",
  );
  await expect(page.locator(".resource-row").first()).toBeVisible();
  await expect(page.locator("#send-request")).toBeEnabled();
  const count = await page.locator(".resource-row").count();
  expect(count).toBeGreaterThan(1);
  const toggle = page.locator(".span-expand").last();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await page.locator(".resource-row").count()).toBeLessThan(count);
  expect(await page.locator(".resource-row").count()).toBeGreaterThan(0);
  await toggle.click();
  await expect(page.locator(".resource-row")).toHaveCount(count);
  await page.locator(".trace-technical > summary").click();
  await expect(page.locator(".trace-technical")).toContainText("with jitter");
  await expect(page.locator(".trace-technical pre")).toHaveCount(0);
});

test("resource names stay literal in autoscale and structured editor adds, reorders and removes programs", async ({
  page,
}) => {
  await ready(page);
  await pause(page);
  await page.locator("#edit-resources").click();
  const editor = page.locator(".program-editor");
  await editor
    .getByRole("button", { name: "Add resource", exact: true })
    .click();
  await editor.getByLabel("Box", { exact: true }).selectOption("r1");
  const name = editor.getByLabel("Name", { exact: true });
  await name.fill("Queue");
  await name.blur();
  await editor.getByLabel("Box", { exact: true }).selectOption("");
  await editor.getByRole("button", { name: "Add stage", exact: true }).click();
  const stage = editor.locator(".stage-editor").last();
  await stage.getByRole("button", { name: "Add call", exact: true }).click();
  await stage.getByLabel("Target", { exact: true }).selectOption("r:r1");
  await stage.getByLabel("Transport", { exact: true }).selectOption("ideal");
  await stage.getByText("Overrides and conditions", { exact: true }).click();
  await stage
    .getByRole("switch", { name: "Timeout override, ms", exact: true })
    .check();
  await stage
    .getByRole("button", { name: "Move up", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Apply without reset", exact: true })
    .click();
  await expect(page.locator("#config-error")).not.toBeEmpty();
  await page.locator("#apply-config").click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  const group = await page.evaluate(() =>
    window.audit.snapshot.config.groups.find((g) => g.id === "db")!,
  );
  expect(group.resources!.find((r) => r.id === "r1")!.name).toBe("Queue");
  expect(
    group.stages.some((s) =>
      s.calls.some((c) => c.resource === "r1" && c.timeout === 0),
    ),
  ).toBe(true);
  await page.locator("#language").selectOption("ru");
  await page.locator('[data-group="db"] .autoscale-card').click();
  await expect(page.locator('#auto-controls option[value="r1"]')).toHaveText(
    "Queue",
  );
  await page.locator("#language").selectOption("en");
  await page.locator('[data-node="db-1"] .node-select').click();
  await page.locator("#edit-resources").click();
  const addedStage = editor
    .locator(".stage-editor")
    .filter({ has: page.locator('select option[value="r:r1"]:checked') });
  await addedStage
    .locator(":scope > .editor-item")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await editor
    .locator(":scope > .editor-item")
    .filter({ hasText: "Queue" })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await page.locator("#apply-config").click();
  await expect(page.locator("#config-dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.audit.snapshot.config.groups
        .find((g) => g.id === "db")!
        .resources!.some((r) => r.id === "r1"),
    ),
  ).toBe(false);
});

test("locality edits respect scope, preserve overrides, and do not reset virtual time", async ({
  page,
}) => {
  await ready(page);
  await pause(page);
  const time = await page.locator("#clock").textContent();
  await number(page, "#workers", "37");
  await page.locator("#box-locality > summary").click();
  let labels = page
    .locator("#box-locality")
    .getByLabel("Own labels · key=value", { exact: true });
  await labels.fill("rack=one");
  await labels.blur();
  await page.locator('[data-scope="group"]').click();
  await page.locator("#box-locality > summary").click();
  labels = page
    .locator("#box-locality")
    .getByLabel("Own labels · key=value", { exact: true });
  await labels.fill("rack=group");
  await labels.blur();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.audit.snapshot.nodes.find((n) => n.id === "db-1")!.labels
            ?.rack,
      ),
    )
    .toBe("one");
  await page.locator('[data-scope="node"]').click();
  await page.locator("#box-locality > summary").click();
  await page
    .locator("#box-locality")
    .getByRole("button", { name: "Inherit", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.audit.snapshot.nodes.find((n) => n.id === "db-1")!.labels
            ?.rack,
      ),
    )
    .toBe("group");
  await expect(page.locator("#workers")).toHaveValue("37");
  await page.locator("#generator-node").click();
  await page.locator("#request-locality > summary").click();
  const requestLabels = page.locator("#request-locality textarea");
  await requestLabels.fill("rack=request");
  await requestLabels.blur();
  await page
    .locator("#request-locality")
    .getByRole("switch", { name: "Distribute one label", exact: true })
    .click();
  await page
    .locator("#request-locality")
    .getByRole("switch", { name: "Prefer matching labels", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        labels: window.audit.snapshot.config.requestLabels,
        percent: window.audit.snapshot.config.requestTag?.percent,
        source: window.audit.snapshot.config.entryAffinity?.source,
      })),
    )
    .toEqual({ labels: { rack: "request" }, percent: 50, source: "request" });
  await expect(page.locator("#clock")).toHaveText(time!);
  await expect(page.locator(".sparkline")).toHaveCount(4);
  await page.locator("#notes-toggle").click();
  await expect(page.locator(".diagram-legend")).toBeVisible();
});

test("canvas autoscaling opens independent group settings and preserves live state", async ({
  page,
}) => {
  await ready(page, "autoscale");
  await pause(page);
  const time = await page.locator("#clock").textContent();
  const group = page.locator('[data-group="api"]');
  const card = group.locator(".autoscale-card");
  await expect(page.locator(".inspector #auto-controls")).toHaveCount(0);
  await expect(group.locator(".group-title + .autoscale-card")).toBeVisible();
  await expect(card).not.toContainText("Minimum");
  await expect(
    card.getByTitle("Queue per node", { exact: true }),
  ).toBeVisible();
  await expect(card.getByTitle("Utilization", { exact: true })).toBeVisible();
  const enabledHeight = (await card.boundingBox())!.height;
  expect(enabledHeight).toBeLessThan(75);
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("dialog", { name: "Group autoscaling", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#workers")).toBeHidden();
  const controls = page.locator("#auto-controls");
  await controls.getByRole("switch", { name: "Enabled", exact: true }).click();
  await expect(card).toContainText("Disabled");
  await expect(card.locator(".autoscale-card-metrics")).toHaveCount(0);
  expect((await card.boundingBox())!.height).toBeLessThan(enabledHeight);
  const max = controls.getByRole("spinbutton", {
    name: "Maximum",
    exact: true,
  });
  await max.fill("7");
  await max.blur();
  await expect(card).not.toContainText("Maximum");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.audit.snapshot.config.groups.find((g) => g.id === "api")!
            .autoscale!.max,
      ),
    )
    .toBe(7);
  await expect(page.locator("#clock")).toHaveText(time!);
  await page.locator("#close-settings").click();
  await group.locator(".group-toggle").click();
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(max).toHaveValue("7");
  await page.locator("#language").selectOption("ru");
  await expect(card).toContainText("Автоскейлинг");
  await expect(card).toContainText("Выключен");
  await expect(page.locator("#clock")).toHaveText(time!);
  await page.locator("#language").selectOption("en");
  await page.locator('[data-group="db"] .autoscale-card').click();
  await expect(
    page.locator('[data-group="db"] .autoscale-card'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await expect(
    controls.getByRole("spinbutton", { name: "Maximum", exact: true }),
  ).not.toHaveValue("7");
  await card.click();
  await expect(max).toHaveValue("7");
  await page.locator("#pause").click();
  await max.fill("6");
  await expect.poll(() => page.locator("#clock").textContent()).not.toBe(time);
  await expect(max).toBeFocused();
  await expect(max).toHaveValue("6");
  await max.blur();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.audit.snapshot.config.groups.find((g) => g.id === "api")!
            .autoscale!.max,
      ),
    )
    .toBe(6);
  await pause(page);
  await controls.getByRole("switch", { name: "Enabled", exact: true }).click();
  await expect(
    card.getByTitle("Queue per node", { exact: true }),
  ).toBeVisible();
  await expect(card).not.toContainText("Disabled");
  await page.screenshot({ path: "/tmp/tmlab-autoscale-compact-desktop.png" });
  await page.locator("#preset").selectOption("normal");
  await expect(page.locator("#settings-window")).toBeHidden();
});
