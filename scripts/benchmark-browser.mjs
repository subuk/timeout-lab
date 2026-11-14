// Compare two static builds in isolated Chromium browsers at normal playback.
// Usage: node scripts/benchmark-browser.mjs BEFORE_DIR AFTER_DIR OUTPUT.json
// Optional: BENCH_PRESETS=normal,fanout BENCH_REPEATS=3 BENCH_SECONDS=12
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { platform, arch, cpus } from "node:os";
import { createHash } from "node:crypto";

const [before, after, output] = process.argv.slice(2);
if (!before || !after || !output) {
  throw new Error("Expected BEFORE_DIR AFTER_DIR OUTPUT.json");
}
const presets = (process.env.BENCH_PRESETS ||
  "normal,slow,fanout,hang,autoscale,az,numa,composition").split(",");
const repeats = Number(process.env.BENCH_REPEATS || 3);
const seconds = Number(process.env.BENCH_SECONDS || 12);
const roots = { before: resolve(before), after: resolve(after) };
const types = { ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".html": "text/html" };
const server = createServer(async (req, res) => {
  try {
    const [variant, ...parts] = new URL(req.url, "http://localhost").pathname.slice(1).split("/");
    const root = roots[variant];
    const path = root && resolve(root, parts.join("/") || "index.html");
    if (!path || !path.startsWith(root + sep)) throw new Error("Invalid path");
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const result = {
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0].model },
  settings: { presets, repeats, seconds, viewport: { width: 1440, height: 1100 }, speed: 1, referenceWarmupSeconds: 60, realWarmupSeconds: 3 },
  builds: roots,
  runs: [],
};
result.buildHashes = {};
for (const [variant, root] of Object.entries(roots)) {
  result.buildHashes[variant] = {};
  for (const file of ["core.wasm", "worker.js", "standalone.html"]) {
    result.buildHashes[variant][file] = createHash("sha256").update(await readFile(resolve(root, file))).digest("hex");
  }
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function measure(variant, preset, repeat) {
  const browser = await chromium.launch();
  try {
    result.environment.chromium = browser.version();
    const browserCDP = await browser.newBrowserCDPSession();
    const page = await browser.newPage({ viewport: result.settings.viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("tmlab.language", "en");
      window.bench = { snapshots: 0, sequence: 0 };
      const Native = window.Worker;
      window.Worker = class extends Native {
        constructor(...args) {
          super(...args);
          window.bench.worker = this;
          this.addEventListener("message", ({ data }) => {
            if (data.type === "snapshot") {
              window.bench.latest = data;
              window.bench.snapshots++;
            } else if (data.type === "error") window.bench.error = data.message;
          });
        }
      };
      window.bench.command = (command) => new Promise((resolve, reject) => {
        const requestId = `benchmark-${++window.bench.sequence}`;
        const worker = window.bench.worker;
        const onMessage = ({ data }) => {
          if (data.requestId !== requestId) return;
          worker.removeEventListener("message", onMessage);
          if (data.type === "error") reject(new Error(data.message));
          else resolve();
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ ...command, requestId });
      });
    });
    const workerPromise = page.waitForEvent("worker");
    await page.goto(`${origin}/${variant}/#template=${preset}`);
    const worker = await workerPromise;
    await page.waitForFunction(() => window.bench.latest?.data.t > 0);
    // Start from an exact preset, pause, and warm up equal numbers of arrivals.
    await page.evaluate(async (preset) => {
      if (!window.bench.latest.paused) await window.bench.command({ type: "pause" });
      await window.bench.command({ type: "preset", preset });
      const config = window.bench.latest.data.config;
      const referenceRPS = preset === "composition" ? 80 : 200;
      const target = 60000 * referenceRPS / config.rps;
      for (let elapsed = 0; elapsed < target;) {
        const ms = Math.min(10000, target - elapsed);
        await window.bench.command({ type: "step", ms });
        elapsed += ms;
      }
      await window.bench.command({ type: "pause" });
    }, preset);
    await sleep(3000);
    // This timer covers synchronous Go/WASM execution and snapshot JSON output,
    // not all Worker CPU; process CPU below also includes parse/clone/render/GC.
    await worker.evaluate(() => {
      self.benchWork = { ms: 0, commands: 0 };
      const original = self.labCommand;
      self.labCommand = (command) => {
        const start = performance.now();
        try { return original(command); }
        finally {
          self.benchWork.ms += performance.now() - start;
          self.benchWork.commands++;
        }
      };
    });
    const pageCDP = await page.context().newCDPSession(page);
    await pageCDP.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await pageCDP.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const processes = async () => (await browserCDP.send("SystemInfo.getProcessInfo")).processInfo;
    const sample = async () => ({
      time: performance.now(),
      processes: await processes(),
      main: await metrics(),
      wasm: await worker.evaluate(() => ({ ...self.benchWork })),
      page: await page.evaluate(() => ({
        snapshots: window.bench.snapshots,
        t: window.bench.latest.data.t,
        rps: window.bench.latest.data.config.rps,
        metrics: window.bench.latest.data.metrics,
        groups: window.bench.latest.data.config.groups.map(({ id, count }) => ({ id, count })),
        error: window.bench.error,
      })),
    });
    const start = await sample();
    await sleep(seconds * 1000);
    const end = await sample();
    if (errors.length || end.page.error) throw new Error(JSON.stringify({ errors, error: end.page.error }));
    const wallSeconds = (end.time - start.time) / 1000;
    const cpuByType = {};
    for (const process of end.processes) {
      const previous = start.processes.find((p) => p.id === process.id);
      if (!previous) throw new Error("Browser process changed during measurement");
      cpuByType[process.type] = (cpuByType[process.type] || 0) + process.cpuTime - previous.cpuTime;
    }
    if (start.processes.some((p) => !end.processes.some((q) => q.id === p.id))) throw new Error("Browser process exited during measurement");
    return {
      variant, preset, repeat, wallSeconds,
      cpuMsPerSecond: Object.values(cpuByType).reduce((sum, v) => sum + v, 0) * 1000 / wallSeconds,
      cpuByTypeMsPerSecond: Object.fromEntries(Object.entries(cpuByType).map(([k, v]) => [k, v * 1000 / wallSeconds])),
      mainTaskMsPerSecond: (end.main.TaskDuration - start.main.TaskDuration) * 1000 / wallSeconds,
      wasmMsPerSecond: (end.wasm.ms - start.wasm.ms) / wallSeconds,
      snapshotsPerSecond: (end.page.snapshots - start.page.snapshots) / wallSeconds,
      virtualMsPerSecond: (end.page.t - start.page.t) / wallSeconds,
      jsHeapMiB: end.main.JSHeapUsedSize / 1024 ** 2,
      start: start.page, end: end.page,
    };
  } finally { await browser.close(); }
}

try {
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const preset of presets) {
      // Alternate order to reduce warm-machine/order bias. Never run in parallel.
      for (const variant of repeat % 2 ? ["before", "after"] : ["after", "before"]) {
        const run = await measure(variant, preset, repeat);
        result.runs.push(run);
        await writeFile(output, JSON.stringify(result, null, 2) + "\n");
        console.log(`${repeat}/${repeats} ${preset} ${variant}: CPU ${run.cpuMsPerSecond.toFixed(1)} ms/s, WASM ${run.wasmMsPerSecond.toFixed(1)} ms/s, updates ${run.snapshotsPerSecond.toFixed(2)}/s`);
      }
    }
  }
} finally { await new Promise((done) => server.close(done)); }
